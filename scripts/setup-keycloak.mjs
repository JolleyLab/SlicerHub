#!/usr/bin/env node
/**
 * Keycloak realm provisioning script.
 *
 * Run after: docker compose --profile keycloak up -d
 *
 *   node scripts/setup-keycloak.mjs
 *   node scripts/setup-keycloak.mjs --settings-only   # realm/client settings only:
 *                                                     # no secret rotation, no prompts
 *
 * Idempotent — safe to re-run. Creates or updates:
 *   - slicer-web realm (session lifetimes, brute-force protection, password policy,
 *     event retention, SMTP)
 *   - slicer-web-backend client (confidential; redirect login with PKCE only — the
 *     password grant is off, so the app never handles passwords)
 *   - Realm roles: app-user, app-org-admin, app-admin
 *   - Token mapper: roles claim in access token
 *   - The first admin account (required — not skippable). The app's own
 *     registration flow needs an existing admin to approve new signups, so on a
 *     fresh instance there's no other way in. Logging in with this account at
 *     the main app auto-provisions the local user record on first login.
 *
 * Writes KEYCLOAK_CLIENT_SECRET to .env on completion.
 *
 * To add a new role or change realm settings, edit this file and re-run.
 * Changes appear as code diffs rather than JSON blob diffs.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const ENV_FILE  = path.join(ROOT, '.env');

// ---------------------------------------------------------------------------
// Realm definition — edit here to change realm configuration
// ---------------------------------------------------------------------------

const REALM_NAME  = 'slicer-web';
const CLIENT_ID   = 'slicer-web-backend';

const env = readEnvFile(ENV_FILE);

// Public app origin (what browsers use). Keycloak's pages live under <this>/sso/.
const PUBLIC_APP_URL = (env.PUBLIC_APP_URL || env.APP_PUBLIC_URL || 'http://localhost:8000').replace(/\/+$/, '');

const DAY_SECONDS = 24 * 60 * 60;

/** "Name <addr@x>" or "addr@x" → { from, fromDisplayName } */
function parseFrom(value) {
    const m = String(value || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (m) return { from: m[2].trim(), fromDisplayName: m[1].replace(/^"|"$/g, '').trim() };
    return { from: String(value || '').trim(), fromDisplayName: '' };
}

const IS_PRODUCTION = (env.NODE_ENV || '').trim() === 'production';

/**
 * Realm SMTP from the app's SMTP_* settings, so Keycloak's emails (password reset,
 * email verification, account setup) go out the same way the app's do.
 *
 * Keycloak has no "show the link instead" fallback the way the app does, so outside
 * production with no SMTP configured it uses the local Mailpit container (read the
 * mail at http://localhost:8025) — nothing leaves the machine.
 * In production with no SMTP, returns undefined (a re-run never wipes a configured one)
 * and main() warns.
 */
function smtpServerFromEnv() {
    const host = (env.SMTP_HOST || '').trim();
    if (!host || env.SMTP_ENABLED === 'false') {
        if (IS_PRODUCTION) return undefined;
        return { host: 'mailpit', port: '1025', from: 'noreply@localhost', fromDisplayName: 'SlicerHub (local)', ssl: 'false', starttls: 'false', auth: 'false' };
    }
    const { from, fromDisplayName } = parseFrom(env.SMTP_FROM || 'SlicerHub <noreply@localhost>');
    const user = (env.SMTP_USER || '').trim();
    return {
        host,
        port:            String(env.SMTP_PORT || '587'),
        from,
        fromDisplayName: fromDisplayName || 'SlicerHub',
        ssl:             env.SMTP_SECURE === 'true' ? 'true' : 'false',
        starttls:        env.SMTP_SECURE === 'true' ? 'false' : (user ? 'true' : 'false'),
        auth:            user ? 'true' : 'false',
        ...(user ? { user, password: env.SMTP_PASS || '' } : {}),
    };
}

const REALM_CONFIG = {
    realm:        REALM_NAME,
    enabled:      true,
    // Shown on Keycloak's sign-in pages (keycloak/themes/slicerhub).
    displayName:      'SlicerHub',
    displayNameHtml:  'SlicerHub',
    loginTheme:       'slicerhub',
    emailTheme:       'slicerhub',

    // Languages on with English only: Keycloak then sets <html lang="en"> on its pages
    // (WCAG 3.1.1) without showing a language picker.
    internationalizationEnabled: true,
    supportedLocales:            ['en'],
    defaultLocale:               'en',

    // Token lifetimes. The backend issues its own session cookies after login;
    // Keycloak tokens are short-lived because they're only used at sign-in
    // (the ID token is kept, encrypted, for sign-out) — not as browser session tokens.
    accessTokenLifespan:         300,   // 5 minutes
    // Keycloak sign-in session = how long a "session ended" popup can sign the user
    // back in without a password. Matches the app's normal session rules
    // (docs/redirect-login-and-sessions-design.md): 30 min idle, 12 h absolute.
    ssoSessionIdleTimeout:       1800,  // 30 minutes
    ssoSessionMaxLifespan:       12 * 60 * 60, // 12 hours

    // Self-registration, email verification and password reset on Keycloak's own pages
    // (design doc rollout phase 5). New self-registered accounts have no app-user role, so
    // they wait at "Access pending approval" until a reviewer approves them.
    // An enabled account whose email isn't verified is asked to verify it at its next
    // sign-in — main() lists any such account.
    registrationAllowed:         true,
    registrationEmailAsUsername: true,   // SlicerHub identifies people by email
    editUsernameAllowed:         false,
    rememberMe:                  false,
    verifyEmail:                 true,
    resetPasswordAllowed:        true,

    // People sign in with their email address
    loginWithEmailAllowed:       true,
    duplicateEmailsAllowed:      false,

    // Brute-force protection
    bruteForceProtected:         true,
    failureFactor:               5,     // lock after 5 failures
    waitIncrementSeconds:        60,
    maxFailureWaitSeconds:       900,   // 15 minutes max lockout

    // Password policy
    passwordPolicy: [
        'length(8)',
        'notUsername',
        'notEmail'
    ].join(' and '),

    // Event records, kept 30 days (design doc decision 6): sign-in events for
    // security investigations (they include the client IP — mention in the privacy
    // notice); admin events without user representations, to avoid copying profiles.
    eventsEnabled:               true,
    eventsExpiration:            30 * DAY_SECONDS,
    adminEventsEnabled:          true,
    adminEventsDetailsEnabled:   false,
    attributes: {
        adminEventsExpiration:   String(30 * DAY_SECONDS),
    },

    ...(smtpServerFromEnv() ? { smtpServer: smtpServerFromEnv() } : {}),
};

const CLIENT_CONFIG = {
    clientId:                   CLIENT_ID,
    enabled:                    true,
    clientAuthenticatorType:    'client-secret',
    // Direct Access Grants = the OAuth password grant (deprecated; no SSO). Off: sign-in
    // is Keycloak's own page. Turned off on existing realms too, each time this runs.
    directAccessGrantsEnabled:  false,
    // Standard flow = redirect sign-in (authorization code + PKCE): the only way in.
    standardFlowEnabled:        true,
    implicitFlowEnabled:        false,
    serviceAccountsEnabled:     false,
    publicClient:               false,
    frontchannelLogout:         false,
    // "Back to SlicerHub" link on Keycloak's pages (e.g. after finishing account setup).
    baseUrl:                    `${PUBLIC_APP_URL}/`,
    redirectUris: [
        `${PUBLIC_APP_URL}/api/auth/callback`,
        `${PUBLIC_APP_URL}/api/auth/popup-callback`,
    ],
    // The browser never calls Keycloak's APIs directly (backend-for-frontend).
    webOrigins: [],
    attributes: {
        'pkce.code.challenge.method':          'S256',
        'post.logout.redirect.uris':           `${PUBLIC_APP_URL}/`,
        // Keycloak tells the backend (on the Docker network) when a sign-in session
        // ends elsewhere, so the app session ends too.
        'backchannel.logout.url':              'http://backend:8080/api/auth/backchannel-logout',
        'backchannel.logout.session.required': 'true',
        'backchannel.logout.revoke.offline.tokens': 'false',
    },
};

const ROLES = [
    { name: 'app-user',      description: 'Standard clinician account' },
    { name: 'app-org-admin', description: 'Organisation administrator' },
    { name: 'app-admin',     description: 'Full system administrator' },
];

// Adds a "roles" array claim to the access token, ID token, and userinfo endpoint.
// The backend reads this claim to determine the user's role without calling Keycloak
// on every request.
const ROLES_MAPPER = {
    name:           'realm roles',
    protocol:       'openid-connect',
    protocolMapper: 'oidc-usermodel-realm-role-mapper',
    consentRequired: false,
    config: {
        'claim.name':          'roles',
        'jsonType.label':      'String',
        'access.token.claim':  'true',
        'id.token.claim':      'true',
        'userinfo.token.claim':'true',
        'multivalued':         'true',
        'aggregate.attrs':     'false',
    }
};

// ---------------------------------------------------------------------------
// Config from environment / .env
// ---------------------------------------------------------------------------

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return Object.fromEntries(
        fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(line => line.includes('=') && !line.trim().startsWith('#'))
            .map(line => {
                const idx = line.indexOf('=');
                return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
            })
    );
}

// KEYCLOAK_URL is the internal Docker service URL (http://keycloak:8080) used by the
// backend container. This script runs on the host, so it needs the host-accessible port.
// KEYCLOAK_ADMIN_URL overrides when the exposed port differs from the default 8082.
const KEYCLOAK_URL    = env.KEYCLOAK_ADMIN_URL || 'http://localhost:8082';
const ADMIN_USER      = env.KEYCLOAK_ADMIN_USER     || 'admin';
const ADMIN_PASSWORD  = env.KEYCLOAK_ADMIN_PASSWORD || 'admin';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ok(msg)      { console.log(`  ✔  ${msg}`); }
function skip(msg)    { console.log(`  –  ${msg} (already exists)`); }
function step(msg)    { console.log(`\n  ${msg}`); }
function warn(msg)    { console.warn(`  ⚠  ${msg}`); }

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForKeycloak(maxMs = 120_000) {
    // /realms/master is on the main HTTP port (8080) and returns 200 when KC is ready.
    // The /health endpoint is on the management port (9000) and requires extra config.
    const url = `${KEYCLOAK_URL}/realms/master`;
    const deadline = Date.now() + maxMs;
    process.stdout.write('\n  Waiting for Keycloak to be ready');
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) { process.stdout.write('\n'); return; }
        } catch { /* not up yet */ }
        process.stdout.write('.');
        await wait(3000);
    }
    process.stdout.write('\n');
    throw new Error(`Keycloak did not become healthy within ${maxMs / 1000}s`);
}

async function getAdminToken() {
    const res = await fetch(
        `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'password',
                client_id:  'admin-cli',
                username:   ADMIN_USER,
                password:   ADMIN_PASSWORD
            })
        }
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin login failed (${res.status}): ${text}`);
    }
    return (await res.json()).access_token;
}

async function api(token, method, path, body) {
    const res = await fetch(`${KEYCLOAK_URL}${path}`, {
        method,
        headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, json, text };
}

// ---------------------------------------------------------------------------
// Provisioning steps
// ---------------------------------------------------------------------------

async function ensureRealm(token) {
    step('Realm');
    const check = await api(token, 'GET', `/admin/realms/${REALM_NAME}`);
    if (check.status === 200) {
        // Merge realm attributes so unmanaged ones (set by Keycloak) are kept.
        const merged = {
            ...REALM_CONFIG,
            attributes: { ...(check.json?.attributes || {}), ...REALM_CONFIG.attributes },
        };
        const res = await api(token, 'PUT', `/admin/realms/${REALM_NAME}`, merged);
        if (!res.ok) throw new Error(`Failed to update realm (${res.status}): ${res.text}`);
        skip(`realm "${REALM_NAME}" (settings updated)`);
    } else {
        const res = await api(token, 'POST', '/admin/realms', REALM_CONFIG);
        if (!res.ok) throw new Error(`Failed to create realm (${res.status}): ${res.text}`);
        ok(`realm "${REALM_NAME}" created`);
    }
}

async function ensureRoles(token) {
    step('Roles');
    for (const role of ROLES) {
        const check = await api(token, 'GET', `/admin/realms/${REALM_NAME}/roles/${encodeURIComponent(role.name)}`);
        if (check.status === 200) {
            skip(`role "${role.name}"`);
        } else {
            const res = await api(token, 'POST', `/admin/realms/${REALM_NAME}/roles`, role);
            if (!res.ok) throw new Error(`Failed to create role "${role.name}" (${res.status}): ${res.text}`);
            ok(`role "${role.name}" created`);
        }
    }
}

/**
 * Registration fields on Keycloak's sign-up page, matching the app's access-request
 * form: both optional. Copied into the review item when the account first signs in and
 * removed from the account once a reviewer approves it (privacy minimization).
 */
const REGISTRATION_ATTRIBUTES = [
    {
        name: 'affiliation',
        displayName: 'Affiliation (institution or organization)',
        validations: { length: { max: 200 } },
        annotations: {},
        permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
        multivalued: false,
    },
    {
        name: 'intendedUse',
        displayName: 'How do you plan to use SlicerHub?',
        validations: { length: { max: 2000 } },
        annotations: { inputType: 'textarea' },
        permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
        multivalued: false,
    },
];

async function ensureRegistrationAttributes(token) {
    step('Registration fields (user profile)');
    const res = await api(token, 'GET', `/admin/realms/${REALM_NAME}/users/profile`);
    if (!res.ok) { warn(`Could not read the user profile (${res.status})`); return; }
    const profile = res.json;
    const attributes = [...(profile.attributes || [])];
    let changed = false;
    for (const attr of REGISTRATION_ATTRIBUTES) {
        const i = attributes.findIndex((a) => a.name === attr.name);
        if (i === -1) { attributes.push(attr); changed = true; }
        else if (JSON.stringify(attributes[i]) !== JSON.stringify({ ...attributes[i], ...attr })) {
            attributes[i] = { ...attributes[i], ...attr };
            changed = true;
        }
    }
    if (!changed) { skip('affiliation, intendedUse'); return; }
    const put = await api(token, 'PUT', `/admin/realms/${REALM_NAME}/users/profile`, { ...profile, attributes });
    if (!put.ok) throw new Error(`Failed to update the user profile (${put.status}): ${put.text}`);
    ok('affiliation, intendedUse');
}

/**
 * verifyEmail is on: an enabled account whose email isn't verified is asked to verify it
 * at its next sign-in (Keycloak sends the email). Accounts set up through Keycloak's own
 * flows are verified; list any made by hand.
 */
async function warnUnverifiedAccounts(token) {
    step('Email verification check');
    const res = await api(token, 'GET', `/admin/realms/${REALM_NAME}/users?max=1000&briefRepresentation=false`);
    if (!res.ok) { warn(`Could not list users (${res.status})`); return; }
    const unverified = (res.json || []).filter((u) => u.enabled && !u.emailVerified
        && !(u.requiredActions || []).includes('VERIFY_EMAIL')
        && !String(u.username || '').startsWith('service-account-'));
    if (!unverified.length) { skip('every enabled account has a verified email'); return; }
    warn(`${unverified.length} enabled account(s) have an unverified email and must verify it at their next sign-in:`);
    for (const u of unverified.slice(0, 20)) warn(`  ${u.email || u.username}`);
    warn('If you know these addresses are right, tick "Email verified" for them in the admin console.');
}

/**
 * Approval gate safety: Keycloak gives every new account its realm's default roles.
 * If an app role were among them, every self-registered or hospital-SSO account would
 * be approved on creation. Remove any that slipped in.
 */
async function ensureDefaultRolesExcludeAppRoles(token) {
    step('Default roles (approval gate)');
    const realm = await api(token, 'GET', `/admin/realms/${REALM_NAME}`);
    const defaultRoleId = realm.json?.defaultRole?.id;
    if (!defaultRoleId) { warn('Could not read the realm default role'); return; }
    const comps = await api(token, 'GET', `/admin/realms/${REALM_NAME}/roles-by-id/${defaultRoleId}/composites`);
    const appNames = new Set(ROLES.map(r => r.name));
    const offending = (comps.json || []).filter(r => appNames.has(r.name));
    if (!offending.length) {
        skip('no app roles in the default roles');
        return;
    }
    const res = await api(token, 'DELETE', `/admin/realms/${REALM_NAME}/roles-by-id/${defaultRoleId}/composites`, offending);
    if (!res.ok) throw new Error(`Failed to remove app roles from default roles (${res.status}): ${res.text}`);
    ok(`removed ${offending.map(r => r.name).join(', ')} from the default roles`);
}

/**
 * The admin console signs in through the master realm. KC_HOSTNAME makes every realm
 * use the public <PUBLIC_APP_URL>/sso address, where nginx blocks the master realm on
 * purpose — so the console showed "somethingWentWrong". Give the master realm its own
 * frontend URL: the localhost-only admin address.
 */
async function ensureMasterRealmUsesAdminUrl(token) {
    step('Admin console address (master realm)');
    const res = await api(token, 'GET', '/admin/realms/master');
    if (!res.ok) { warn(`Could not read the master realm (${res.status})`); return; }
    const attributes = res.json?.attributes || {};
    if (attributes.frontendUrl === KEYCLOAK_URL) { skip(`master realm uses ${KEYCLOAK_URL}`); return false; }
    const put = await api(token, 'PUT', '/admin/realms/master', { attributes: { ...attributes, frontendUrl: KEYCLOAK_URL } });
    if (!put.ok) throw new Error(`Failed to set the master realm address (${put.status}): ${put.text}`);
    ok(`master realm uses ${KEYCLOAK_URL}`);
    return true; // changed: tokens issued before this now have the wrong issuer
}

async function ensureClient(token) {
    step('Client');
    const list = await api(token, 'GET', `/admin/realms/${REALM_NAME}/clients?clientId=${encodeURIComponent(CLIENT_ID)}`);
    if (!list.ok) throw new Error(`Failed to list clients (${list.status})`);

    const existing = list.json?.find(c => c.clientId === CLIENT_ID);
    let clientUuid;

    if (existing) {
        clientUuid = existing.id;
        // Merge attributes rather than replace them: Keycloak keeps other client
        // settings there that this script doesn't manage.
        const merged = {
            ...existing,
            ...CLIENT_CONFIG,
            attributes: { ...(existing.attributes || {}), ...CLIENT_CONFIG.attributes },
        };
        const res = await api(token, 'PUT', `/admin/realms/${REALM_NAME}/clients/${clientUuid}`, merged);
        if (!res.ok) throw new Error(`Failed to update client (${res.status}): ${res.text}`);
        skip(`client "${CLIENT_ID}" (settings updated)`);
    } else {
        const res = await api(token, 'POST', `/admin/realms/${REALM_NAME}/clients`, CLIENT_CONFIG);
        if (!res.ok) throw new Error(`Failed to create client (${res.status}): ${res.text}`);
        // Keycloak returns the UUID in the Location header; re-fetch to get it
        const refetch = await api(token, 'GET', `/admin/realms/${REALM_NAME}/clients?clientId=${encodeURIComponent(CLIENT_ID)}`);
        clientUuid = refetch.json?.[0]?.id;
        if (!clientUuid) throw new Error('Client created but UUID could not be retrieved');
        ok(`client "${CLIENT_ID}" created`);
    }

    return clientUuid;
}

async function ensureRolesMapper(token, clientUuid) {
    step('Token mapper');
    const list = await api(token, 'GET', `/admin/realms/${REALM_NAME}/clients/${clientUuid}/protocol-mappers/models`);
    if (!list.ok) throw new Error(`Failed to list mappers (${list.status})`);

    const existing = list.json?.find(m => m.name === ROLES_MAPPER.name);
    if (existing) {
        skip(`mapper "${ROLES_MAPPER.name}"`);
    } else {
        const res = await api(token, 'POST',
            `/admin/realms/${REALM_NAME}/clients/${clientUuid}/protocol-mappers/models`,
            ROLES_MAPPER
        );
        if (!res.ok) throw new Error(`Failed to create mapper (${res.status}): ${res.text}`);
        ok(`mapper "${ROLES_MAPPER.name}" created`);
    }
}

async function regenerateAndSaveSecret(token, clientUuid) {
    step('Client secret');
    const res = await api(token, 'POST', `/admin/realms/${REALM_NAME}/clients/${clientUuid}/client-secret`);
    if (!res.ok) throw new Error(`Failed to regenerate secret (${res.status}): ${res.text}`);
    const secret = res.json?.value;
    if (!secret) throw new Error('Secret regenerated but value was empty');

    upsertEnvVar(ENV_FILE, 'KEYCLOAK_CLIENT_SECRET', secret);
    ok('KEYCLOAK_CLIENT_SECRET written to .env');
    return secret;
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

function prompt(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`  ${question}`, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function promptSecret(question) {
    return new Promise(resolve => {
        process.stdout.write(`  ${question}`);
        // null output suppresses echo
        const rl = readline.createInterface({ input: process.stdin, output: null });
        rl.once('line', answer => {
            process.stdout.write('\n');
            rl.close();
            resolve(answer.trim());
        });
    });
}

// ---------------------------------------------------------------------------
// First admin account — required, prompts interactively if not already in .env
// ---------------------------------------------------------------------------

async function ensureTestUser(token) {
    const current = readEnvFile(ENV_FILE);
    // bootstrap.mjs collects this once and passes it to both this script and
    // setup-payload-admin.mjs via env vars (never written to .env or any file) —
    // only used as a fallback, so running this script standalone still prompts.
    let email    = (current.KEYCLOAK_TEST_USER_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
    const role   = (current.KEYCLOAK_TEST_USER_ROLE  || 'app-admin').trim();

    step('Create admin account');

    // Not skippable: without this, there is no way to log into the app at all — the
    // registration flow requires an existing admin to approve new accounts, and on a
    // fresh instance there isn't one yet. This is the bootstrap out of that chicken-
    // and-egg problem, not an optional dev convenience.
    if (!current.KEYCLOAK_TEST_USER_EMAIL) {
        while (!email) {
            email = await prompt('Admin account email: ');
            if (!email) warn('Email is required — try again');
        }
        upsertEnvVar(ENV_FILE, 'KEYCLOAK_TEST_USER_EMAIL', email);
        ok(`KEYCLOAK_TEST_USER_EMAIL written to .env`);
    } else {
        skip(`KEYCLOAK_TEST_USER_EMAIL (${email})`);
    }

    let password = (process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim();
    if (password.length >= 8) {
        ok('Using admin password from bootstrap.mjs');
    }
    while (password.length < 8) {
        password = await promptSecret('Admin account password (min 8 chars): ');
        if (password && password.length >= 8) break;
        warn(password ? 'Password must be at least 8 characters — try again' : 'Password is required — try again');
    }

    // Find by email
    const search = await api(token, 'GET',
        `/admin/realms/${REALM_NAME}/users?email=${encodeURIComponent(email)}&exact=true`
    );
    if (!search.ok) throw new Error(`User search failed (${search.status}): ${search.text}`);

    let userId;
    const existing = search.json?.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (existing) {
        userId = existing.id;
        // Update to ensure email-verified and enabled
        await api(token, 'PUT', `/admin/realms/${REALM_NAME}/users/${userId}`, {
            email,
            emailVerified: true,
            enabled: true,
        });
        skip(`user "${email}" (updated)`);
    } else {
        const [firstName, ...rest] = email.split('@')[0].split('.');
        const create = await api(token, 'POST', `/admin/realms/${REALM_NAME}/users`, {
            email,
            username:      email,
            firstName:     firstName || 'Dev',
            lastName:      rest.join(' ') || 'User',
            emailVerified: true,
            enabled:       true,
        });
        if (!create.ok) throw new Error(`Failed to create user (${create.status}): ${create.text}`);

        // Re-fetch to get the UUID Keycloak assigned
        const refetch = await api(token, 'GET',
            `/admin/realms/${REALM_NAME}/users?email=${encodeURIComponent(email)}&exact=true`
        );
        userId = refetch.json?.[0]?.id;
        if (!userId) throw new Error('User created but UUID could not be retrieved');
        ok(`user "${email}" created`);
    }

    // Set / reset password
    const pwRes = await api(token, 'PUT',
        `/admin/realms/${REALM_NAME}/users/${userId}/reset-password`,
        { type: 'password', value: password, temporary: false }
    );
    if (!pwRes.ok) {
        throw new Error(`Failed to set password (${pwRes.status}): ${pwRes.text}`);
    }
    ok('password set');

    // Assign realm role
    const roleRes = await api(token, 'GET',
        `/admin/realms/${REALM_NAME}/roles/${encodeURIComponent(role)}`
    );
    if (!roleRes.ok) throw new Error(`Role "${role}" not found — check KEYCLOAK_TEST_USER_ROLE`);

    await api(token, 'POST',
        `/admin/realms/${REALM_NAME}/users/${userId}/role-mappings/realm`,
        [{ id: roleRes.json.id, name: role }]
    );
    ok(`role "${role}" assigned`);

    // Approval gate: every approved account holds app-user (admin roles also pass the
    // gate, but holding app-user keeps the account approved if the admin role is removed).
    if (role !== 'app-user') {
        const appUser = await api(token, 'GET', `/admin/realms/${REALM_NAME}/roles/app-user`);
        if (appUser.ok) {
            await api(token, 'POST',
                `/admin/realms/${REALM_NAME}/users/${userId}/role-mappings/realm`,
                [{ id: appUser.json.id, name: 'app-user' }]
            );
            ok('role "app-user" assigned');
        }
    }
}

// ---------------------------------------------------------------------------
// .env helper
// ---------------------------------------------------------------------------

function upsertEnvVar(filePath, key, value) {
    const line = `${key}=${value}`;
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `${line}\n`, 'utf8');
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.match(new RegExp(`^\\s*#?\\s*${key}\\s*=`)));
    if (idx !== -1) {
        lines[idx] = line;
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    } else {
        const sep = content.endsWith('\n') ? '' : '\n';
        fs.appendFileSync(filePath, `${sep}${line}\n`, 'utf8');
    }
}

// ---------------------------------------------------------------------------
// Seed missing .env vars (only writes when the key is absent)
// ---------------------------------------------------------------------------

async function seedEnvVars() {
    step('.env config');
    const current = readEnvFile(ENV_FILE);

    // KEYCLOAK_URL: use the internal Docker service URL for the backend container.
    // The script itself uses KEYCLOAK_ADMIN_URL (host-accessible); this value is
    // what the backend reads at runtime inside Docker.
    //
    // KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD: also read by the backend at
    // runtime for the change-password flow (Admin REST API). Seeded here so the
    // backend container has them without manual copy-paste.
    const defaults = [
        ['KEYCLOAK_URL',            'http://keycloak:8080'],
        ['KEYCLOAK_REALM',          REALM_NAME],
        ['KEYCLOAK_CLIENT_ID',      CLIENT_ID],
        ['KEYCLOAK_ADMIN_USER',     ADMIN_USER],
        ['KEYCLOAK_ADMIN_PASSWORD', ADMIN_PASSWORD],
    ];

    for (const [key, value] of defaults) {
        if (!current[key]) {
            upsertEnvVar(ENV_FILE, key, value);
            ok(`${key}=${value} written to .env`);
        } else {
            skip(`${key} already set`);
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\nKeycloak provisioning\n');
    console.log(`  URL:   ${KEYCLOAK_URL}`);
    console.log(`  Realm: ${REALM_NAME}`);

    await waitForKeycloak();
    ok('Keycloak is healthy');

    step('Admin token');
    let token = await getAdminToken();
    ok('Admin token obtained');

    if (await ensureMasterRealmUsesAdminUrl(token)) token = await getAdminToken();
    await ensureRealm(token);
    await ensureRoles(token);
    await ensureDefaultRolesExcludeAppRoles(token);
    await ensureRegistrationAttributes(token);
    await warnUnverifiedAccounts(token);
    if (!REALM_CONFIG.smtpServer) {
        warn('No SMTP configured: Keycloak cannot send verification, password-reset or account-setup emails. Set SMTP_* in .env and re-run.');
    }
    const clientUuid = await ensureClient(token);
    await ensureRolesMapper(token, clientUuid);

    // --settings-only: apply realm/client settings after pulling config changes,
    // without rotating the client secret or touching the admin account.
    if (process.argv.includes('--settings-only')) {
        console.log('\n  Settings applied (--settings-only: client secret and admin account untouched).\n');
        return;
    }

    await regenerateAndSaveSecret(token, clientUuid);
    await seedEnvVars();
    await ensureTestUser(token);

    console.log(`
  ─────────────────────────────────────────────
  Done. Keycloak is provisioned and ready.

  Next step: set AUTH_PROVIDER=keycloak in .env, then restart the backend.
  ─────────────────────────────────────────────
`);
}

main().catch(err => {
    console.error(`\n  ✖  ${err.message}\n`);
    process.exit(1);
});
