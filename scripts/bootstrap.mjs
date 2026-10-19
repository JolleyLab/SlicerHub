#!/usr/bin/env node
/**
 * One-time dev environment bootstrap.
 *
 *   node scripts/bootstrap.mjs
 *
 * Requires: Docker Desktop running, .env present with at minimum:
 *   INFISICAL_ENCRYPTION_KEY=<hex>
 *   INFISICAL_AUTH_SECRET=<base64>
 *   COMPOSE_PROFILES=keycloak,payload
 *   AUTH_PROVIDER=keycloak
 *
 * What it does:
 *   1. docker compose up -d           (starts all services including Infisical)
 *   2. node scripts/setup-infisical.mjs (first-time Infisical setup + secrets migration)
 *   3. node scripts/setup-keycloak.mjs  (provisions realm, writes KEYCLOAK_CLIENT_SECRET)
 *   4. node scripts/setup-payload.mjs   (waits for postgres, writes PAYLOAD_DATABASE_URI + PAYLOAD_SECRET)
 *   5. start.mjs up -d backend        (restarts backend with secrets injected from Infisical)
 *
 * Idempotent — safe to re-run on an already-running stack.
 * After bootstrap: use  node scripts/start.mjs  instead of  docker compose.
 */

import { execSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

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
        throw new Error(
            '.env not found.\n' +
            '  Copy .env.example → .env and set at minimum:\n' +
            '    INFISICAL_ENCRYPTION_KEY=<hex>  (openssl rand -hex 16)\n' +
            '    INFISICAL_AUTH_SECRET=<base64>  (openssl rand -base64 32)\n' +
            '    COMPOSE_PROFILES=keycloak,payload\n' +
            '    AUTH_PROVIDER=keycloak'
        );
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

    ok('.env found');
}

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

// ---------------------------------------------------------------------------
// .env write helper
// ---------------------------------------------------------------------------

function upsertEnvVar(filePath, key, value) {
    const line = `${key}=${value}`;
    if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, `${line}\n`, 'utf8'); return; }
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

    // Generate Infisical bootstrap secrets before starting services — the
    // Infisical container refuses to start if AUTH_SECRET or ENCRYPTION_KEY
    // are missing, so these must exist in .env before `docker compose up`.
    const env = readEnvFile(ENV_FILE);
    if (!env.INFISICAL_ENCRYPTION_KEY) {
        const key = crypto.randomBytes(16).toString('hex');
        upsertEnvVar(ENV_FILE, 'INFISICAL_ENCRYPTION_KEY', key);
        ok('INFISICAL_ENCRYPTION_KEY generated and written to .env');
    } else {
        skip('INFISICAL_ENCRYPTION_KEY already set');
    }
    if (!env.INFISICAL_AUTH_SECRET) {
        const secret = crypto.randomBytes(32).toString('base64');
        upsertEnvVar(ENV_FILE, 'INFISICAL_AUTH_SECRET', secret);
        ok('INFISICAL_AUTH_SECRET generated and written to .env');
    } else {
        skip('INFISICAL_AUTH_SECRET already set');
    }

    step('Starting services  (docker compose up -d)');
    run('docker compose up', 'docker', ['compose', 'up', '-d']);
    ok('Services started');

    step('Setting up Infisical secret manager');
    runScript(path.join(__dirname, 'setup-infisical.mjs'));

    await collectAdminCredentials();

    step('Provisioning Keycloak');
    runScript(path.join(__dirname, 'setup-keycloak.mjs'));

    step('Provisioning Payload DB');
    runScript(path.join(__dirname, 'setup-payload.mjs'));

    step('Syncing backend dependencies  (npm install inside container)');
    run('npm install', 'docker', ['compose', 'run', '--rm', '--no-deps', 'backend', 'npm', 'install']);
    ok('backend/package-lock.json up to date');

    step('Restarting backend  (picks up Infisical secrets + fresh node_modules)');
    run('start.mjs up backend', process.execPath, [path.join(__dirname, 'start.mjs'), 'up', '-d', 'backend']);
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
│  Infisical:     http://localhost:8888       │
│  Keycloak:      http://localhost:8082       │
│  Payload admin: http://localhost:3001/admin │
│  Email (local): http://localhost:8025       │
│                                             │
│  Start services (with Infisical injection): │
│    node scripts/start.mjs up -d             │
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
