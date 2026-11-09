#!/usr/bin/env node
/**
 * One-step setup for a fresh clone (also safe to re-run on a running stack).
 *
 *   node scripts/bootstrap.mjs
 *
 * Requires Docker. Creates .env if there isn't one.
 *
 * What it does:
 *   1. Generates any missing secrets into .env (lib/secrets.mjs) — DB passwords, the
 *      Keycloak admin password, PAYLOAD_SECRET, AUTH_TOKEN_KEY. Nothing runs on a default.
 *   2. docker compose up -d, then reloads nginx (picks up nginx/*.conf changes after a pull)
 *   3. node scripts/setup-keycloak.mjs  (realm + sign-in client — redirect sign-in only,
 *                                       password grant off — and writes KEYCLOAK_CLIENT_SECRET)
 *   4. node scripts/setup-payload.mjs   (waits for postgres, writes PAYLOAD_DATABASE_URI)
 *   5. Restarts the backend so it reads the new .env values. On its first start against
 *      a realm the backend grants app-user to existing accounts (the approval gate's
 *      one-off rollout step, recorded in a realm attribute).
 *
 * Afterwards, plain `docker compose` is all you need. Secrets: docs/secrets-management.md.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readEnvFile, prompt, promptSecret } from './lib/env.mjs';
import { ensureSecrets, secretsOnKnownDefaults } from './lib/secrets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const ENV_FILE  = path.join(ROOT, '.env');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ok(msg)   { console.log(`  ✔  ${msg}`); }
function skip(msg) { console.log(`  –  ${msg}`); }
function step(msg) { console.log(`\n━━  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function preflight() {
    step('Preflight checks');

    if (!fs.existsSync(ENV_FILE)) {
        // A local setup needs only these; .env.example lists everything else (production
        // settings, email, optional features).
        fs.writeFileSync(ENV_FILE, [
            '# Local settings and secrets. Never commit this file. Options: .env.example',
            'COMPOSE_PROFILES=keycloak,payload',
            'AUTH_PROVIDER=keycloak',
            '',
        ].join('\n'), 'utf8');
        ok('.env created for a local setup (see .env.example for the other options)');
    }

    const env = readEnvFile(ENV_FILE);
    const profiles = (env.COMPOSE_PROFILES || '').split(',').map(s => s.trim()).filter(Boolean);
    const missing = [];
    if (!profiles.includes('keycloak')) missing.push('keycloak');
    if (!profiles.includes('payload'))  missing.push('payload');
    if (missing.length) {
        warn(`COMPOSE_PROFILES in .env is missing: ${missing.join(', ')}`);
        warn('Add them or bootstrap will skip those services.');
    }

    if (!env.AUTH_PROVIDER) {
        warn('AUTH_PROVIDER is not set in .env — recommend AUTH_PROVIDER=keycloak');
    }

    // Keycloak builds its sign-in links from PUBLIC_APP_URL (<url>/sso/). The default
    // (http://localhost:8000) is right for local dev; other machines must set it.
    if (env.PUBLIC_APP_URL && !/^https?:\/\//.test(env.PUBLIC_APP_URL)) {
        warn(`PUBLIC_APP_URL should be a full origin like http://localhost:8000 (got "${env.PUBLIC_APP_URL}")`);
    }

    ok('.env checked');
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

function composeProjectName() {
    const env = readEnvFile(ENV_FILE);
    return (process.env.COMPOSE_PROJECT_NAME || env.COMPOSE_PROJECT_NAME || path.basename(ROOT))
        .toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function volumeExists(name) {
    const out = spawnSync('docker', ['volume', 'ls', '-q',
        '--filter', `label=com.docker.compose.project=${composeProjectName()}`,
        '--filter', `label=com.docker.compose.volume=${name}`], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error('Could not list Docker volumes. Is Docker running?');
    return out.stdout.trim() !== '';
}

function setUpSecrets() {
    step('Secrets  (.env)');
    const written = ensureSecrets(ENV_FILE, volumeExists);
    if (!written.length) skip('All secrets already set');
    for (const { key, how } of written) {
        if (how === 'generated') ok(`${key} generated`);
        else ok(`${key} set to the value the existing database was created with`);
    }
    const weak = secretsOnKnownDefaults(ENV_FILE);
    if (weak.length) {
        warn(`Still on a public default: ${weak.join(', ')}. Fine on your own machine; change them`);
        warn('before others can reach this server (docs/secrets-management.md → Changing a secret).');
    }
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

/**
 * Collect the admin account's email/password once here, instead of separately in
 * setup-keycloak.mjs and setup-payload-admin.mjs. Passed to both via env vars on the
 * child process (BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD) — never written to
 * .env or any file; each sub-script still falls back to its own interactive prompt
 * when run standalone, outside of bootstrap.mjs.
 */
async function collectAdminCredentials() {
    step('Admin account');
    console.log('  Used for both the Keycloak login and the Payload admin UI.');

    let email = '';
    while (!email) {
        email = await prompt('Admin account email: ');
        if (!email) warn('Email is required — try again');
    }

    let password = '';
    while (true) {
        password = await promptSecret('Admin account password (min 8 chars): ');
        if (password && password.length >= 8) break;
        warn(password ? 'Password must be at least 8 characters — try again' : 'Password is required — try again');
    }

    process.env.BOOTSTRAP_ADMIN_EMAIL = email;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = password;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function run(label, cmd, args = []) {
    console.log(`\n  $ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`${label} failed (exit ${result.status})`);
    }
}

function runScript(scriptPath) {
    // Invoke sub-script directly via the Node binary — spawnSync without shell
    // so a path with spaces (e.g. C:\Program Files\nodejs\node.exe) is not split.
    console.log(`\n  $ node ${path.basename(scriptPath)}`);
    const result = spawnSync(process.execPath, [scriptPath], {
        cwd: ROOT,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error(`${path.basename(scriptPath)} failed (exit ${result.status})`);
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log('│        SlicerWeb dev environment setup      │');
    console.log('└─────────────────────────────────────────────┘');

    preflight();

    setUpSecrets();

    step('Starting services  (docker compose up -d)');
    run('docker compose up', 'docker', ['compose', 'up', '-d']);
    ok('Services started');

    // nginx reads its config from the mounted nginx/ folder; `up -d` doesn't restart an
    // unchanged container, so after pulling new routes (e.g. Keycloak at /sso/) reload it.
    const reload = spawnSync('docker', ['exec', 'nginx', 'nginx', '-s', 'reload'], { cwd: ROOT, stdio: 'pipe' });
    if (reload.status === 0) ok('nginx config reloaded');
    else warn('Could not reload nginx (is it running?) — run: docker exec nginx nginx -s reload');

    await collectAdminCredentials();

    step('Provisioning Keycloak');
    runScript(path.join(__dirname, 'setup-keycloak.mjs'));

    step('Provisioning Payload DB');
    runScript(path.join(__dirname, 'setup-payload.mjs'));

    step('Syncing backend dependencies  (npm install inside container)');
    run('npm install', 'docker', ['compose', 'run', '--rm', '--no-deps', 'backend', 'npm', 'install']);
    ok('backend/package-lock.json up to date');

    step('Restarting backend  (picks up the new .env values + fresh node_modules)');
    run('docker compose up backend', 'docker', ['compose', 'up', '-d', '--force-recreate', 'backend']);
    ok('Backend restarted');

    const finalEnv = readEnvFile(ENV_FILE);
    const profiles = (finalEnv.COMPOSE_PROFILES || '').split(',').map(s => s.trim()).filter(Boolean);

    if (profiles.includes('payload')) {
        step('Syncing payload-admin dependencies  (npm install inside container)');
        run('npm install', 'docker', ['compose', 'run', '--rm', '--no-deps', 'payload-admin', 'npm', 'install']);
        ok('payload-admin/package-lock.json up to date');

        step('Starting payload-admin service');
        run('docker compose up payload-admin', 'docker', ['compose', 'up', '-d', 'payload-admin']);
        ok('payload-admin starting (Next.js dev — takes ~30s on first request)');

        step('Provisioning Payload admin user');
        runScript(path.join(__dirname, 'setup-payload-admin.mjs'));
    }

    console.log(`
┌─────────────────────────────────────────────┐
│                    Done!                    │
├─────────────────────────────────────────────┤
│  App:           http://localhost:8000       │
│  Keycloak admin: http://localhost:8082/admin│
│  Sign-in pages: http://localhost:8000/sso/  │
│  Payload admin: http://localhost:3001/admin │
│  Email (local): http://localhost:8025       │
│   (Keycloak's verify / reset / account-     │
│    setup emails — nothing leaves the PC)    │
│                                             │
│  Start / stop services:                     │
│    docker compose up -d   /   down          │
│                                             │
│  Tail backend logs:                         │
│    docker compose logs -f backend           │
└─────────────────────────────────────────────┘
`);
}

main().catch(err => {
    console.error(`\n  ✖  ${err.message}\n`);
    process.exit(1);
});
