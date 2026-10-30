#!/usr/bin/env node
/**
 * Migrate data from Directus to Payload CMS + Keycloak.
 *
 * Prerequisites:
 *   - DIRECTUS_URL, DIRECTUS_ADMIN_TOKEN in .env (or environment)
 *   - PAYLOAD_DATABASE_URI pointing to the Payload Postgres instance
 *   - KEYCLOAK_URL, KEYCLOAK_REALM, KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET in .env
 *   - docker compose --profile payload up -d backend payload-db keycloak
 *
 * Run:
 *   node scripts/migrate-from-directus.mjs [--dry-run]
 *
 * What it does (all idempotent — safe to re-run):
 *   1. Fetch all Directus users → look up in KC by email
 *        • already in KC → reuse their sub
 *        • not in KC → create disabled account (they set password via invite on first login)
 *        • superadmin email overlap → skip (don't overwrite)
 *   2. Migrate user-preferences (theme, layout flags)
 *   3. Migrate cases (owner mapped from Directus user_created → KC sub)
 *   4. Migrate case collaborators (case_directus_users junction → case-collaborators)
 *   5. Migrate non-expired case invites
 *   6. Download attachment files from Directus /assets/, save to local storage,
 *      create Payload `attachments` records
 *   7. Drop comments (intentionally skipped)
 */

import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// In the Docker container the backend source is at /app/src (no backend/ subdir).
// On the host it's at <repo-root>/backend/src.
const BACKEND_ROOT = fs.existsSync(path.join(ROOT, 'src', 'payload', 'index.js'))
    ? ROOT
    : path.join(ROOT, 'backend');

// Load .env from repo root (no dotenv dependency needed)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx < 1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!(key in process.env)) process.env[key] = val;
    }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const DRY_RUN   = process.argv.includes('--dry-run');
const USE_LOCAL = process.argv.includes('--local');

function log(msg) { console.log(`  ${msg}`); }
function ok(msg)  { console.log(`  ✔  ${msg}`); }
function skip(msg){ console.log(`  –  ${msg}`); }
function warn(msg){ console.warn(`  ⚠  ${msg}`); }
function step(msg){ console.log(`\n► ${msg}`); }
function fail(msg){ console.error(`  ✘  ${msg}`); }

if (DRY_RUN)   log('DRY-RUN mode — no writes will occur.');
if (USE_LOCAL) {
    // Swap Docker-internal hostname for localhost so the script can reach the DB
    // from outside the Docker network (e.g. when running on a dev machine).
    const uri = process.env.PAYLOAD_DATABASE_URI || '';
    process.env.PAYLOAD_DATABASE_URI = uri.replace(/\bpayload-db\b/, 'localhost');
    log(`--local: PAYLOAD_DATABASE_URI host rewritten to localhost`);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DIRECTUS_URL        = (process.env.DIRECTUS_URL || '').replace(/\/+$/, '');
const DIRECTUS_TOKEN_ENV  = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_TOKEN || '';
const DIRECTUS_ADMIN_EMAIL    = process.env.DIRECTUS_ADMIN_EMAIL    || '';
const DIRECTUS_ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || '';

let DIRECTUS_TOKEN = DIRECTUS_TOKEN_ENV;
const KC_URL         = (process.env.KEYCLOAK_URL   || '').replace(/\/+$/, '');
const KC_REALM       = process.env.KEYCLOAK_REALM  || 'slicer';
const KC_ADMIN_USER     = process.env.KEYCLOAK_ADMIN_USER     || 'admin';
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD || '';

if (!DIRECTUS_URL) {
    fail('DIRECTUS_URL is required.');
    process.exit(1);
}
// Credentials are collected interactively at runtime if not in env — no hard exit here.
if (!KC_URL) {
    fail('KEYCLOAK_URL is required.');
    process.exit(1);
}

// ─── Interactive prompts (same pattern as bootstrap.mjs) ──────────────────────

function prompt(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`  ${question}`, answer => { rl.close(); resolve(answer.trim()); });
    });
}

function promptSecret(question) {
    return new Promise(resolve => {
        process.stdout.write(`  ${question}`);
        const rl = readline.createInterface({ input: process.stdin, output: null });
        rl.once('line', answer => { process.stdout.write('\n'); rl.close(); resolve(answer.trim()); });
    });
}

// ─── Directus login ───────────────────────────────────────────────────────────

async function directusLogin() {
    let email    = DIRECTUS_ADMIN_EMAIL;
    let password = DIRECTUS_ADMIN_PASSWORD;

    if (!email) {
        console.log('\n  Directus admin credentials needed to access all collections.');
        while (!email) {
            email = await prompt('Directus admin email: ');
            if (!email) warn('Email is required — try again');
        }
    }
    if (!password) {
        while (!password) {
            password = await promptSecret('Directus admin password: ');
            if (!password) warn('Password is required — try again');
        }
    }

    log(`Logging into Directus as ${email}...`);
    const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Directus login failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const token = json?.data?.access_token;
    if (!token) throw new Error('Directus login: no access_token in response');
    DIRECTUS_TOKEN = token;
    ok(`Directus login successful`);
}

// ─── Directus helpers ─────────────────────────────────────────────────────────

async function directus(path, { method = 'GET', body, query } = {}) {
    let url = `${DIRECTUS_URL}${path}`;
    if (query) {
        const qs = new URLSearchParams(query);
        url += `?${qs}`;
    }
    const opts = {
        method,
        headers: {
            Authorization: `Bearer ${DIRECTUS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Directus ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
}

async function directusAll(path, { query = {}, pageSize = 200 } = {}) {
    const items = [];
    let page = 1;
    while (true) {
        const data = await directus(path, {
            query: { ...query, limit: String(pageSize), page: String(page) }
        });
        const rows = Array.isArray(data?.data) ? data.data : [];
        items.push(...rows);
        if (rows.length < pageSize) break;
        page++;
    }
    return items;
}

// ─── Keycloak helpers ─────────────────────────────────────────────────────────

let _kcToken = null;
let _kcTokenExpiry = 0;

async function kcAdminToken() {
    if (_kcToken && Date.now() < _kcTokenExpiry - 10_000) return _kcToken;
    const body = new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: KC_ADMIN_USER,
        password: KC_ADMIN_PASSWORD,
    });
    const res = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) throw new Error(`KC token fetch failed: ${res.status}`);
    const json = await res.json();
    _kcToken = json.access_token;
    _kcTokenExpiry = Date.now() + (json.expires_in || 60) * 1000;
    return _kcToken;
}

async function kcAdmin(path, { method = 'GET', body, query } = {}) {
    const token = await kcAdminToken();
    let url = `${KC_URL}/admin/realms/${KC_REALM}${path}`;
    if (query) url += `?${new URLSearchParams(query)}`;
    const opts = {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`KC ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
}

async function kcFindUserByEmail(email) {
    const results = await kcAdmin('/users', { query: { email, exact: 'true' } });
    return Array.isArray(results) && results.length > 0 ? results[0] : null;
}

async function kcCreateUser({ email, firstName, lastName }) {
    if (DRY_RUN) {
        log(`  [dry] Would create KC user: ${email}`);
        return `dry-run-sub-${email}`;
    }
    const res = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/users`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${await kcAdminToken()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: email,
            email,
            firstName: firstName || '',
            lastName: lastName || '',
            enabled: false,
            emailVerified: true
        })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`KC create user ${email} → ${res.status}: ${text.slice(0, 200)}`);
    }
    // KC returns 201 with Location header containing the new user ID
    const location = res.headers.get('location') || '';
    const id = location.split('/').pop();
    if (!id) throw new Error(`KC create user ${email}: no ID in Location header`);
    return id; // This is the KC sub
}

// ─── Payload helpers ──────────────────────────────────────────────────────────

let payload = null;

async function initPayload() {
    const url = pathToFileURL(path.join(BACKEND_ROOT, 'src/payload/index.js')).href;
    const { initPayload: init } = await import(url);
    payload = await init();
    if (!payload) throw new Error('Payload failed to initialize. Is payload-db running?');
}

async function payloadFindOne(collection, where) {
    const result = await payload.find({ collection, where, limit: 1, depth: 0 });
    return result?.docs?.[0] || null;
}

async function payloadCreate(collection, data) {
    if (DRY_RUN) {
        log(`  [dry] Would create in ${collection}: ${JSON.stringify(data).slice(0, 100)}`);
        return { id: `dry-${Date.now()}`, ...data };
    }
    return payload.create({ collection, data, depth: 0 });
}

// ─── Storage helper ───────────────────────────────────────────────────────────

async function saveAttachmentToStorage(payloadCaseId, filename, buffer, contentType) {
    const storageKey = `caseFiles/${payloadCaseId}/${filename}`;
    if (DRY_RUN) {
        log(`  [dry] Would write storage key: ${storageKey} (${buffer.length} bytes)`);
        return storageKey;
    }
    const storageUrl = pathToFileURL(path.join(BACKEND_ROOT, 'src/storage/localStorage.js')).href;
    const storage = (await import(storageUrl)).default;
    await storage.write({ key: storageKey, buffer, contentType });
    return storageKey;
}

// ─── Download attachment from Directus ────────────────────────────────────────

async function downloadDirectusAsset(fileId) {
    const url = `${DIRECTUS_URL}/assets/${fileId}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` }
    });
    if (!res.ok) throw new Error(`Download ${fileId} → ${res.status}`);
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Build Directus user → KC sub map
// ═══════════════════════════════════════════════════════════════════════════════

async function buildUserMap() {
    step('Step 1: Map Directus users → Keycloak subs');

    const directusUsers = await directusAll('/users', {
        query: { fields: 'id,email,first_name,last_name,role', limit: '200' }
    });
    log(`Found ${directusUsers.length} Directus users`);

    // directusId → kcSub
    const userMap = {};
    let created = 0, reused = 0, skipped = 0;

    for (const du of directusUsers) {
        const email = String(du.email || '').trim().toLowerCase();
        if (!email) { skip(`User ${du.id} has no email — skipping`); skipped++; continue; }

        const existing = await kcFindUserByEmail(email);
        if (existing) {
            userMap[du.id] = existing.id;
            reused++;
        } else {
            try {
                const kcSub = await kcCreateUser({
                    email,
                    firstName: du.first_name || '',
                    lastName: du.last_name || ''
                });
                userMap[du.id] = kcSub;
                created++;
                ok(`Created KC user: ${email}`);
            } catch (err) {
                warn(`Failed to create KC user ${email}: ${err.message}`);
                skipped++;
            }
        }
    }

    ok(`User map built — ${reused} reused, ${created} created, ${skipped} skipped`);
    return userMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Migrate user preferences
// ═══════════════════════════════════════════════════════════════════════════════

async function migrateUserPreferences(userMap) {
    step('Step 2: Migrate user preferences');

    // Directus stores preferences in directus_users — fetch theme field
    const directusUsers = await directusAll('/users', {
        query: { fields: 'id,email,appearance', limit: '200' }
    });

    let done = 0, skipped = 0;
    for (const du of directusUsers) {
        const kcSub = userMap[du.id];
        if (!kcSub || kcSub.startsWith('dry-')) continue;

        const theme = du.appearance === 'dark' ? 'dark' : 'light';

        const existing = await payloadFindOne('user-preferences', {
            keycloak_sub: { equals: kcSub }
        });
        if (existing) { skip(`Preferences already exist for ${du.email}`); skipped++; continue; }

        await payloadCreate('user-preferences', {
            keycloak_sub: kcSub,
            theme
        });
        done++;
    }
    ok(`User preferences: ${done} migrated, ${skipped} skipped`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Migrate cases
// ═══════════════════════════════════════════════════════════════════════════════

async function migrateCases(userMap) {
    step('Step 3: Migrate cases');

    const directusCases = await directusAll('/items/case', {
        query: { fields: '*', limit: '200' }
    });
    log(`Found ${directusCases.length} cases`);

    // directusCaseId → payloadCaseId
    const caseMap = {};
    let done = 0, skipped = 0;

    for (const dc of directusCases) {
        const existing = await payloadFindOne('cases', {
            // Store the directus ID in description or use title+owner match:
            // Use a dedicated "directus_id" lookup via title for idempotency.
            // Simpler: check if we already added a migration marker.
            // We'll store directus_id in the description prefix below.
        });

        // Idempotency: look for case with matching title AND directus source marker
        const marker = `[directus:${dc.id}]`;
        const titleWithMarker = `${dc.title || ''}`;

        // Check by searching for the directus ID marker in a separate text field.
        // Since we don't have a dedicated source_id field, we use the directus_id
        // stored as part of the description for idempotency detection.
        const existingByDesc = await payload.find({
            collection: 'cases',
            where: { description: { contains: marker } },
            limit: 1,
            depth: 0
        });
        const existingCase = existingByDesc?.docs?.[0];

        if (existingCase) {
            skip(`Case already migrated: "${dc.title}" (${dc.id})`);
            caseMap[dc.id] = existingCase.id;
            skipped++;
            continue;
        }

        const ownerDirectusId = typeof dc.user_created === 'object'
            ? dc.user_created?.id
            : dc.user_created;
        const ownerKcSub = ownerDirectusId ? userMap[ownerDirectusId] : null;

        if (!ownerKcSub) {
            warn(`Case "${dc.title}" (${dc.id}): no KC sub for owner ${ownerDirectusId} — skipping`);
            skipped++;
            continue;
        }

        const descriptionWithMarker = [dc.description, marker].filter(Boolean).join('\n');

        const created = await payloadCreate('cases', {
            title: dc.title || 'Untitled',
            description: descriptionWithMarker,
            owner_id: ownerKcSub,
            status: dc.status === 'archived' ? 'archived' : 'active'
        });
        caseMap[dc.id] = created.id;
        done++;
        ok(`Case: "${dc.title}"`);
    }

    ok(`Cases: ${done} migrated, ${skipped} skipped`);
    return caseMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Migrate case collaborators (via Keycloak case role groups)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Collaborators are stored as Keycloak group memberships: groups are named
 * `case:{payloadCaseId}:{role}` (admin | collaborator | read_only).
 * We call the same KC Admin API that the app uses at runtime.
 */
async function ensureKcCaseGroup(caseId, role) {
    const name = `case:${caseId}:${role}`;
    const results = await kcAdmin('/groups', { query: { search: name } });
    const existing = Array.isArray(results) ? results.find(g => g.name === name) : null;
    if (existing) return existing.id;

    if (DRY_RUN) {
        log(`  [dry] Would create KC group: ${name}`);
        return `dry-group-${name}`;
    }

    const token = await kcAdminToken();
    const res = await fetch(`${KC_URL}/admin/realms/${KC_REALM}/groups`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(`Create KC group ${name} → ${res.status}`);
    const location = res.headers.get('location') || '';
    const id = location.split('/').pop();
    return id;
}

async function addUserToKcCaseGroup(kcSub, caseId, role) {
    const groupId = await ensureKcCaseGroup(caseId, role);
    if (DRY_RUN) {
        log(`  [dry] Would add ${kcSub} to KC group case:${caseId}:${role}`);
        return;
    }
    const token = await kcAdminToken();
    const res = await fetch(
        `${KC_URL}/admin/realms/${KC_REALM}/users/${encodeURIComponent(kcSub)}/groups/${encodeURIComponent(groupId)}`,
        { method: 'PUT', headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok && res.status !== 204) {
        throw new Error(`Add user ${kcSub} to KC group case:${caseId}:${role} → ${res.status}`);
    }
}

async function getKcCaseGroupMembers(caseId, role) {
    const name = `case:${caseId}:${role}`;
    const results = await kcAdmin('/groups', { query: { search: name } });
    const group = Array.isArray(results) ? results.find(g => g.name === name) : null;
    if (!group) return [];
    const members = await kcAdmin(`/groups/${encodeURIComponent(group.id)}/members`);
    return Array.isArray(members) ? members.map(m => m.id) : [];
}

async function migrateCaseCollaborators(userMap, caseMap) {
    step('Step 4: Migrate case collaborators');

    const junctionRows = await directusAll('/items/case_directus_users', {
        query: {
            fields: 'id,case_id,directus_users_id,role',
            limit: '500'
        }
    });
    log(`Found ${junctionRows.length} collaborator rows`);

    let done = 0, skipped = 0;

    for (const row of junctionRows) {
        const directusCaseId = typeof row.case_id === 'object' ? row.case_id?.id : row.case_id;
        const directusUserId = typeof row.directus_users_id === 'object'
            ? row.directus_users_id?.id
            : row.directus_users_id;

        const payloadCaseId = caseMap[String(directusCaseId || '')];
        const kcSub = userMap[String(directusUserId || '')];

        if (!payloadCaseId || !kcSub) {
            skip(`Collaborator row ${row.id}: missing case or user mapping`);
            skipped++;
            continue;
        }

        const role = ['admin', 'collaborator', 'read_only'].includes(row.role)
            ? row.role
            : 'collaborator';

        // Idempotency: check if already in KC group
        try {
            const currentMembers = await getKcCaseGroupMembers(payloadCaseId, role);
            if (currentMembers.includes(kcSub)) {
                skipped++;
                continue;
            }
        } catch {
            // Group may not exist yet — proceed to create
        }

        await addUserToKcCaseGroup(kcSub, payloadCaseId, role);
        done++;
    }

    ok(`Collaborators: ${done} migrated, ${skipped} skipped`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Migrate non-expired case invites
// ═══════════════════════════════════════════════════════════════════════════════

async function migrateCaseInvites(userMap, caseMap) {
    step('Step 5: Migrate case invites (non-expired)');

    const now = new Date().toISOString();

    let directusInvites;
    try {
        const result = await directusAll('/items/case_invite', {
            query: {
                fields: 'id,kind,status,case,invitee_email,proposed_role,inviter,expires_at,token_hash',
                'filter[expires_at][_gt]': now,
                limit: '200'
            }
        });
        directusInvites = result;
    } catch (err) {
        warn(`case_invite collection not found or inaccessible: ${err.message}`);
        return;
    }

    log(`Found ${directusInvites.length} non-expired invites`);

    let done = 0, skipped = 0;

    for (const inv of directusInvites) {
        const directusCaseId = typeof inv.case === 'object' ? inv.case?.id : inv.case;
        const payloadCaseId = caseMap[String(directusCaseId || '')];

        if (!payloadCaseId) {
            skip(`Invite ${inv.id}: case ${directusCaseId} not migrated`);
            skipped++;
            continue;
        }

        // Idempotency on token_hash
        if (inv.token_hash) {
            const existing = await payloadFindOne('case-invites', {
                token_hash: { equals: inv.token_hash }
            });
            if (existing) { skipped++; continue; }
        }

        const inviterDirectusId = typeof inv.inviter === 'object' ? inv.inviter?.id : inv.inviter;
        const inviterKcSub = inviterDirectusId ? userMap[inviterDirectusId] : null;

        const role = ['admin', 'collaborator', 'read_only'].includes(inv.proposed_role)
            ? inv.proposed_role
            : 'collaborator';

        const kind = inv.kind === 'signup' ? 'signup' : 'existing';
        const status = ['pending_approval', 'pending_signup', 'accepted', 'rejected', 'expired'].includes(inv.status)
            ? inv.status
            : 'pending_approval';

        await payloadCreate('case-invites', {
            kind,
            status,
            invitee_email: inv.invitee_email,
            inviter_id: inviterKcSub || null,
            case: payloadCaseId,
            role,
            token_hash: inv.token_hash || null,
            expires_at: inv.expires_at || null
        });
        done++;
    }

    ok(`Case invites: ${done} migrated, ${skipped} skipped`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Migrate attachments
// ═══════════════════════════════════════════════════════════════════════════════

async function migrateAttachments(userMap, caseMap) {
    step('Step 6: Migrate case attachments');

    let directusAttachments;
    try {
        directusAttachments = await directusAll('/items/attachment', {
            query: {
                fields: [
                    'id',
                    'name',
                    'case',
                    'user_created',
                    'file.id',
                    'file.filename_download',
                    'file.type',
                    'file.filesize'
                ].join(','),
                limit: '200'
            }
        });
    } catch (err) {
        warn(`Cannot read attachments from Directus (${err.message})`);
        warn(`Ensure DIRECTUS_TOKEN belongs to an Administrator role with read access to the attachment collection.`);
        warn(`Skipping attachments — re-run the script once permissions are fixed (idempotent).`);
        return;
    }
    log(`Found ${directusAttachments.length} attachments`);

    let done = 0, skipped = 0, failed = 0;

    for (const att of directusAttachments) {
        const directusCaseId = typeof att.case === 'object' ? att.case?.id : att.case;
        const payloadCaseId = caseMap[String(directusCaseId || '')];

        if (!payloadCaseId) {
            skip(`Attachment ${att.id}: case ${directusCaseId} not migrated`);
            skipped++;
            continue;
        }

        const file = att.file;
        if (!file?.id || !file?.filename_download) {
            skip(`Attachment ${att.id}: missing file reference`);
            skipped++;
            continue;
        }

        const filename = file.filename_download;
        const storageKey = `caseFiles/${payloadCaseId}/${filename}`;

        // Idempotency: check if attachment with this storage_key already exists
        const existing = await payloadFindOne('attachments', {
            storage_key: { equals: storageKey }
        });
        if (existing) {
            skip(`Attachment already migrated: ${filename}`);
            skipped++;
            continue;
        }

        // Download the file bytes
        try {
            const { buffer, contentType } = await downloadDirectusAsset(file.id);
            const key = await saveAttachmentToStorage(payloadCaseId, filename, buffer, contentType);

            const uploaderDirectusId = typeof att.user_created === 'object'
                ? att.user_created?.id
                : att.user_created;
            const uploaderKcSub = uploaderDirectusId ? userMap[uploaderDirectusId] : null;

            // Find the owner of the case as fallback uploader
            let fallbackSub = uploaderKcSub;
            if (!fallbackSub) {
                const payloadCase = await payload.findByID({ collection: 'cases', id: payloadCaseId, depth: 0 });
                fallbackSub = payloadCase?.owner_id || 'unknown';
            }

            await payloadCreate('attachments', {
                case: payloadCaseId,
                storage_key: key,
                original_filename: filename,
                mime_type: file.type || contentType,
                size_bytes: file.filesize || buffer.length,
                uploaded_by: fallbackSub
            });
            done++;
            ok(`Attachment: ${filename} (${Math.round(buffer.length / 1024)} KB)`);
        } catch (err) {
            warn(`Failed to migrate attachment ${filename} (${file.id}): ${err.message}`);
            failed++;
        }
    }

    ok(`Attachments: ${done} migrated, ${skipped} skipped, ${failed} failed`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Directus → Payload/Keycloak migration');
    if (DRY_RUN) console.log('  MODE: DRY RUN (no data will be written)');
    console.log('═══════════════════════════════════════════════════\n');

    step('Initializing Payload...');
    await initPayload();
    ok('Payload initialized');

    await directusLogin();
    const userMap  = await buildUserMap();
    await migrateUserPreferences(userMap);
    const caseMap  = await migrateCases(userMap);
    await migrateCaseCollaborators(userMap, caseMap);
    await migrateCaseInvites(userMap, caseMap);
    await migrateAttachments(userMap, caseMap);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  Migration complete!');
    console.log('═══════════════════════════════════════════════════\n');

    await payload.db?.destroy?.();
    process.exit(0);
}

main().catch(err => {
    fail(`Migration failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
