/**
 * One-off: keep every collaborator's role while `case_directus_users.role` is turned from a
 * multiple-select dropdown (values like 1 and ["0"]) into a single-value string dropdown
 * (see docs/directus-schema.md). Delete this script once the migration is done.
 *
 * Old `role` values: 0 = admin, 1 = collaborator, 2 = read only, seen as 0/1/2, "0"/"1"/"2" or ["0"].
 * Strings (admin, collaborator, readonly, read_only) are accepted too.
 *
 * Directus is the source of truth going forward, but for this one-time migration the roles the app
 * saved in SQLite (case_collaborator_roles) are the real ones: role changes made in the app were
 * written there because the Directus writes failed, so Directus mostly still says "collaborator".
 * Case owners (the case's `user_created`) are admin by ownership and were never reliably on the junction,
 * so the export also marks each owner `admin`, adding a junction row when the owner has none. That needs
 * the service token to read `id` and `user_created` on the `case` collection.
 *
 * Pass `--sqlite <copy of users.db>` to use them (repeat the flag for each running copy of the app, for
 * example your laptop and the remote machine); a SQLite role wins over the Directus one.
 * Copy the live file out of the backend container first, e.g.
 *   docker compose cp backend:/app/data/users.db ./users-live.db
 *
 * Run from the repository root; it reads DIRECTUS_URL and DIRECTUS_TOKEN from .env (or the environment):
 *   node backend/scripts/rebuild-collaborator-roles.mjs export [--sqlite users-live.db]
 *       Reads every row, writes backend/collab-roles-backup.json. Changes nothing in Directus.
 *   ... then recreate the `role` field in Directus ...
 *   node backend/scripts/rebuild-collaborator-roles.mjs restore            # dry run
 *   node backend/scripts/rebuild-collaborator-roles.mjs restore --apply    # write
 *
 * The service token must be allowed to read and update `role`, `case_id` and `directus_users_id` on
 * case_directus_users. The backup file holds Directus user and case ids, so keep it out of git.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_FILE = path.join(here, '..', 'collab-roles-backup.json');

for (const candidate of [path.join(here, '..', '..', '.env'), path.join(here, '..', '.env')]) {
    if (fs.existsSync(candidate)) {
        try { process.loadEnvFile(candidate); } catch { /* values already in the environment win */ }
    }
}

const [mode] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const SQLITE_FILES = process.argv.flatMap((arg, i, all) => (arg === '--sqlite' ? [all[i + 1]] : []));
const url = (process.env.DIRECTUS_URL || '').trim().replace(/\/+$/, '');
const token = (process.env.DIRECTUS_TOKEN || '').trim();

if (!['export', 'restore'].includes(mode)) {
    console.error('Usage: rebuild-collaborator-roles.mjs export | restore [--apply]');
    process.exit(1);
}
if (!url || !token) {
    console.error('DIRECTUS_URL and DIRECTUS_TOKEN must be set (in .env or the environment).');
    process.exit(1);
}

const NUMERIC_ROLES = { 0: 'admin', 1: 'collaborator', 2: 'read_only' };

function toRole(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw == null || raw === '') return null;
    const key = String(raw).trim().toLowerCase().replace(/-/g, '_');
    if (key in NUMERIC_ROLES) return NUMERIC_ROLES[key];
    if (key === 'admin') return 'admin';
    if (key === 'collaborator') return 'collaborator';
    if (['readonly', 'read_only', 'observer', 'read'].includes(key)) return 'read_only';
    return null;
}

async function directus(route, { method = 'GET', body } = {}) {
    const res = await fetch(`${url}${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${method} ${route} -> ${res.status}: ${data?.errors?.[0]?.message || res.statusText}`);
    }
    return data;
}

async function allJunctionRows() {
    const rows = [];
    for (let page = 1; ; page += 1) {
        const { data } = await directus(
            `/items/case_directus_users?limit=200&page=${page}&sort=id&fields=id,case_id,directus_users_id,role`
        );
        rows.push(...data);
        if (data.length < 200) break;
    }
    return rows;
}

/** Roles saved by the app in SQLite, keyed "caseId:directusUserId". Empty when no file is given. */
async function sqliteRoles(files) {
    const roles = new Map();
    if (!files.length) return roles;
    const { default: initSqlJs } = await import('sql.js');
    const SQL = await initSqlJs();
    // Each running copy of the app has its own SQLite file; later files win when they disagree.
    for (const file of files) {
        const db = new SQL.Database(fs.readFileSync(file));
        const result = db.exec('SELECT case_id, directus_user_id, role FROM case_collaborator_roles')[0];
        for (const [caseId, userId, role] of result?.values || []) {
            roles.set(`${caseId}:${userId}`, toRole(role));
        }
    }
    return roles;
}

/** Map of caseId -> owner (user_created), or null when the token cannot read cases. */
async function caseOwners() {
    try {
        const owners = new Map();
        for (let page = 1; ; page += 1) {
            const { data } = await directus(`/items/case?limit=200&page=${page}&sort=id&fields=id,user_created`);
            for (const row of data) {
                const owner = row.user_created && typeof row.user_created === 'object' ? row.user_created.id : row.user_created;
                if (owner) owners.set(String(row.id), String(owner));
            }
            if (data.length < 200) break;
        }
        return owners;
    } catch (err) {
        console.warn(`Could not read the case collection (${err.message}).`);
        console.warn('Grant the service token read access to id and user_created on `case` to include owners.');
        return null;
    }
}

if (mode === 'export') {
    const overrides = await sqliteRoles(SQLITE_FILES);
    const out = [];
    let differ = 0;
    for (const row of await allJunctionRows()) {
        const fromDirectus = toRole(row.role);
        const fromSqlite = overrides.get(`${row.case_id}:${row.directus_users_id}`) || null;
        if (fromSqlite && fromDirectus && fromSqlite !== fromDirectus) {
            differ += 1;
            console.warn(`Row ${row.id}: Directus says ${fromDirectus}, SQLite says ${fromSqlite}; using SQLite.`);
        }
        const role = fromSqlite || fromDirectus;
        if (!role) {
            console.warn(`Row ${row.id}: no usable role (role=${JSON.stringify(row.role)}); it will get the field default.`);
        }
        out.push({ id: row.id, case_id: row.case_id, directus_users_id: row.directus_users_id, role });
    }
    const owners = await caseOwners();
    let ownersPromoted = 0;
    let ownersAdded = 0;
    if (owners) {
        for (const [caseId, ownerId] of owners) {
            const entry = out.find((r) => String(r.case_id) === caseId && String(r.directus_users_id) === ownerId);
            if (entry) {
                if (entry.role !== 'admin') {
                    ownersPromoted += 1;
                    entry.role = 'admin';
                }
            } else {
                ownersAdded += 1;
                out.push({ id: null, case_id: caseId, directus_users_id: ownerId, role: 'admin' });
            }
        }
        console.log(`${owners.size} cases with an owner: ${ownersPromoted} owners promoted to admin, ${ownersAdded} owner rows to add.`);
    }
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(out, null, 2));
    const counts = {};
    for (const row of out) counts[row.role || 'none'] = (counts[row.role || 'none'] || 0) + 1;
    console.log(`Wrote ${out.length} rows to ${BACKUP_FILE}`, JSON.stringify(counts));
    if (SQLITE_FILES.length) console.log(`${overrides.size} roles read from SQLite, ${differ} of them different from Directus.`);
    else console.log('No --sqlite file given: roles come from Directus only.');
    console.log('Now recreate the role field in Directus, then run: restore');
} else {
    await restore();
}

async function restore() {
    const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
    const current = new Map((await allJunctionRows()).map((row) => [String(row.id), row]));
    let updated = 0;
    let skipped = 0;
    const byCaseAndUser = new Map([...current.values()].map((r) => [`${r.case_id}:${r.directus_users_id}`, r]));
    for (const saved of backup) {
        if (saved.id == null) {
            // An owner with no junction row: add one, unless it appeared in the meantime.
            const existing = byCaseAndUser.get(`${saved.case_id}:${saved.directus_users_id}`);
            console.log(`${APPLY ? (existing ? 'set' : 'add') : (existing ? 'would set' : 'would add')} owner of case ${saved.case_id} role=${saved.role}`);
            if (APPLY && existing) {
                await directus(`/items/case_directus_users/${existing.id}`, { method: 'PATCH', body: { role: saved.role } });
            } else if (APPLY) {
                await directus('/items/case_directus_users', {
                    method: 'POST',
                    body: { case_id: saved.case_id, directus_users_id: saved.directus_users_id, role: saved.role }
                });
            }
            updated += 1;
            continue;
        }
        const row = current.get(String(saved.id));
        if (!row || String(row.case_id) !== String(saved.case_id) || String(row.directus_users_id) !== String(saved.directus_users_id)) {
            console.warn(`Row ${saved.id} no longer matches the backup (case/user differ or it was deleted); skipping.`);
            skipped += 1;
            continue;
        }
        if (!saved.role || row.role === saved.role) {
            skipped += 1;
            continue;
        }
        console.log(`${APPLY ? 'set' : 'would set'} row ${saved.id} role=${saved.role}`);
        if (APPLY) await directus(`/items/case_directus_users/${saved.id}`, { method: 'PATCH', body: { role: saved.role } });
        updated += 1;
    }
    console.log(JSON.stringify({ backupRows: backup.length, updated, skipped }));
    if (!APPLY) console.log('Dry run. Re-run with --apply to write.');
}
