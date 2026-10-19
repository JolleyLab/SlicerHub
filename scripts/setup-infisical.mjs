#!/usr/bin/env node
/**
 * First-time Infisical setup and secrets migration.
 *
 * What it does:
 *   1. Waits for the Infisical service to be ready.
 *   2. Checks whether a machine identity is already configured in .env.
 *   3. If not: guides you through creating one in the Infisical UI (2 min),
 *      then prompts for the client ID and secret and stores them in .env.
 *   4. Offers to migrate all application secrets from .env into Infisical so
 *      .env can be trimmed to non-sensitive config only.
 *
 * Idempotent — safe to re-run. Skips any step already completed.
 *
 * After this script runs, use  node scripts/start.mjs  instead of
 * `docker compose` so secrets are injected from Infisical at runtime.
 */

import fs       from 'fs'
import path     from 'path'
import readline from 'readline'
import { fileURLToPath } from 'url'

const __dirname       = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE        = path.join(__dirname, '..', '.env')
const INFISICAL_BASE  = 'http://localhost:8888'
const INFISICAL_ENV   = 'dev'

// ---------------------------------------------------------------------------
// Secrets to migrate from .env → Infisical.
// Non-sensitive config (URLs, timeouts, feature flags) stays in .env.
// ---------------------------------------------------------------------------

const SECRETS_TO_MIGRATE = [
    'JWT_SECRET',
    'GPU_CREDENTIALS_KEY',
    'TRAME_SYNC_TOKEN',
    'KEYCLOAK_ADMIN_PASSWORD',
    'KEYCLOAK_DB_PASSWORD',
    'KEYCLOAK_CLIENT_SECRET',
    'KEYCLOAK_ADMIN_CLIENT_SECRET',
    'PAYLOAD_SECRET',
    'PAYLOAD_DB_PASSWORD',
    'CLOUDFLARED_TUNNEL_TOKEN',
    'AUTH_TOKEN_KEY',
    'AUTH_TOKEN_KEY_PREVIOUS',
    'VNC_PASSWORD',
    'DIRECTUS_TOKEN',
    'DIRECTUS_SECRET',
];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ok(msg)   { console.log(`  ✔  ${msg}`); }
function skip(msg) { console.log(`  –  ${msg}`); }
function step(msg) { console.log(`\n━━  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

// ---------------------------------------------------------------------------
// .env helpers
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
// Interactive prompts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Service readiness
// ---------------------------------------------------------------------------

async function waitForInfisical(maxWaitSeconds = 180) {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    process.stdout.write('  Waiting for Infisical to start');
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${INFISICAL_BASE}/api/status`, {
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) { process.stdout.write(' ready\n'); return; }
        } catch { /* not up yet */ }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
    }
    process.stdout.write('\n');
    throw new Error(`Infisical did not start within ${maxWaitSeconds}s`);
}

// ---------------------------------------------------------------------------
// Infisical API helpers
// ---------------------------------------------------------------------------

async function getAccessToken(clientId, clientSecret) {
    const res = await fetch(`${INFISICAL_BASE}/api/v1/auth/universal-auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ clientId, clientSecret }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Machine identity login failed (${res.status}): ${text}`);
    }
    return (await res.json()).accessToken;
}

async function getSecrets(accessToken, projectId) {
    const res = await fetch(
        `${INFISICAL_BASE}/api/v3/secrets/raw?workspaceId=${projectId}&environment=${INFISICAL_ENV}&secretPath=/`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to fetch secrets (${res.status})`);
    const data = await res.json();
    return Object.fromEntries((data.secrets ?? []).map(s => [s.secretKey, s.secretValue]));
}

async function upsertSecret(accessToken, projectId, key, value) {
    // Try create first; if it already exists, update instead. Different Infisical
    // versions have reported this differently — a clean 409, or a 400 with
    // {"message":"Secret already exist", ...} — so check both rather than assume
    // whichever one this particular instance happens to use.
    const body = JSON.stringify({
        workspaceId: projectId,
        environment: INFISICAL_ENV,
        secretPath:  '/',
        secretValue: value,
        type:        'shared',
    });
    const headers = {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
    };

    const create = await fetch(`${INFISICAL_BASE}/api/v3/secrets/raw/${encodeURIComponent(key)}`, {
        method: 'POST', headers, body,
    });

    let alreadyExists = create.status === 409;
    let createText = null;
    if (!create.ok && !alreadyExists) {
        createText = await create.text();
        alreadyExists = create.status === 400 && /already exist/i.test(createText);
    }

    if (alreadyExists) {
        const update = await fetch(`${INFISICAL_BASE}/api/v3/secrets/raw/${encodeURIComponent(key)}`, {
            method: 'PATCH', headers, body,
        });
        if (!update.ok) {
            const text = await update.text();
            throw new Error(`Failed to update secret ${key} (${update.status}): ${text}`);
        }
        return 'updated';
    }
    if (!create.ok) {
        // createText is always already populated here: the only way to reach this line
        // with create.ok false is via the text-read branch above (the 409 case returns
        // early via the update path instead).
        throw new Error(`Failed to create secret ${key} (${create.status}): ${createText}`);
    }
    return 'created';
}

// ---------------------------------------------------------------------------
// Machine identity setup
// ---------------------------------------------------------------------------

async function ensureMachineIdentity() {
    const env = readEnvFile(ENV_FILE);
    let clientId     = (env.INFISICAL_CLIENT_ID     || '').trim();
    let clientSecret = (env.INFISICAL_CLIENT_SECRET || '').trim();
    let projectId    = (env.INFISICAL_PROJECT_ID    || '').trim();

    step('Machine identity');

    if (clientId && clientSecret && projectId) {
        // Verify the stored credentials still work.
        try {
            const token = await getAccessToken(clientId, clientSecret);
            await getSecrets(token, projectId);
            skip('Machine identity already configured and verified');
            return { clientId, clientSecret, projectId };
        } catch {
            warn('Stored credentials could not be verified — re-entering.');
            clientId = clientSecret = projectId = '';
        }
    }

    console.log(`
  Infisical is running at ${INFISICAL_BASE}

  One-time setup (takes ~2 minutes):

  1. Open ${INFISICAL_BASE} and create your admin account
     (no verification email needed — SMTP is intentionally off for local dev)

  2. You will land on the Admin Panel. Infisical auto-creates an "Admin Org".
     Click the Infisical logo (top-left) to go to the main dashboard.

  3. Inside the organisation, create a new project:
     Click "+ Add New Project" (or "Create Project").
     Enter the name:  slicerweb
     Leave type as "Secret Management" and click Create.

  4. Go to Project Settings (gear icon, bottom-left of the project sidebar).
     Copy the Project ID shown at the top of the Settings page — you'll need
     it first below.

  5. In the project, go to Access Management → Access Control, then click
     "Add Identity".
       - If no identity exists yet for your org, Infisical first makes you
         create one at the org level:
            Name:     slicerweb-bootstrap
            Role:     Member   (org-level membership only — this does not
                      grant project access by itself; that's the next part)
         Create it. You'll land back in the project's Access Control.
       - Now add that identity to THIS project with a project role:
            Role:     Developer   (or Admin if Developer turns out to be
                      missing some permission the migration step needs)
         Click Create / Add.

  6. Open the identity (Access Management, left sidebar under "OTHERS" —
     this is the org-level view, not the project-role page you were just
     on). Copy the Client ID shown under "Identity Details".

  7. Under "Authentication", click the gear icon next to "Universal Auth"
     (it's attached by default — no need to "Add Auth Method").
     Create a Client Secret there. Leave TTL and Max Number of Uses blank
     (Infisical has no explicit "unlimited" option — blank/0 means
     unlimited, which is what you want: this identity logs in every time
     anyone runs \`node scripts/start.mjs\`, not just once).
     Copy the Client Secret now — it is shown only once.

  Enter those three values below when prompted, in this order:
  Project ID, then Client ID, then Client Secret.
`);

    if (!projectId) {
        projectId = await prompt('Project ID (from the project Settings → Project ID): ');
        if (!projectId) throw new Error('Project ID is required');
        upsertEnvVar(ENV_FILE, 'INFISICAL_PROJECT_ID', projectId);
        ok('INFISICAL_PROJECT_ID written to .env');
    }

    if (!clientId) {
        clientId = await prompt('Machine identity Client ID: ');
        if (!clientId) throw new Error('Client ID is required');
        upsertEnvVar(ENV_FILE, 'INFISICAL_CLIENT_ID', clientId);
        ok('INFISICAL_CLIENT_ID written to .env');
    }

    clientSecret = await promptSecret('Machine identity Client Secret: ');
    if (!clientSecret) throw new Error('Client Secret is required');

    // Verify before storing.
    const token = await getAccessToken(clientId, clientSecret);
    await getSecrets(token, projectId);
    ok('Credentials verified');

    upsertEnvVar(ENV_FILE, 'INFISICAL_CLIENT_SECRET', clientSecret);
    ok('INFISICAL_CLIENT_SECRET written to .env');

    return { clientId, clientSecret, projectId };
}

// ---------------------------------------------------------------------------
// Secrets migration
// ---------------------------------------------------------------------------

async function migrateSecrets(clientId, clientSecret, projectId) {
    step('Secrets migration');

    const env = readEnvFile(ENV_FILE);
    const candidates = SECRETS_TO_MIGRATE.filter(k => (env[k] || '').trim());

    if (!candidates.length) {
        skip('No application secrets found in .env to migrate');
        return;
    }

    console.log(`\n  Found ${candidates.length} secret(s) in .env that can move to Infisical:`);
    candidates.forEach(k => console.log(`    ${k}`));
    console.log();

    const answer = await prompt('Migrate these to Infisical now? [y/N] ');
    if (answer.toLowerCase() !== 'y') {
        skip('Migration skipped — secrets remain in .env');
        return;
    }

    const token = await getAccessToken(clientId, clientSecret);

    for (const key of candidates) {
        const result = await upsertSecret(token, projectId, key, env[key]);
        ok(`${key} → Infisical (${result})`);
    }

    console.log(`
  ✔  Secrets migrated. You can now remove them from .env — they will be
     injected at runtime by  node scripts/start.mjs.

  Recommended: delete or blank out the migrated lines in .env, keeping only
  non-sensitive config (URLs, timeouts, feature flags, INFISICAL_* bootstrap).
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\n━━  Infisical setup');
    await waitForInfisical();

    const { clientId, clientSecret, projectId } = await ensureMachineIdentity();
    await migrateSecrets(clientId, clientSecret, projectId);

    console.log(`
  ─────────────────────────────────────────────
  Done. Infisical is ready at ${INFISICAL_BASE}

  Going forward, use:
    node scripts/start.mjs up -d
  instead of:
    docker compose up -d

  This injects Infisical secrets as environment variables before starting
  services. Your .env is only needed for non-sensitive config.
  ─────────────────────────────────────────────
`);
}

main().catch(err => {
    console.error(`\n  ✖  ${err.message}\n`);
    process.exit(1);
});
