#!/usr/bin/env node
/**
 * Payload CMS + Postgres provisioning script.
 *
 * Run after: docker compose --profile payload up -d payload-db
 *
 *   node scripts/setup-payload.mjs
 *
 * Idempotent — safe to re-run. Run it after every update that changes the Payload
 * collections (bootstrap.mjs does).
 *
 * What this script does:
 *   1. Waits for payload-db (Postgres) to accept connections
 *   2. Generates PAYLOAD_SECRET if not already in .env
 *   3. Writes PAYLOAD_DATABASE_URI, PAYLOAD_DB_USER, PAYLOAD_DB_PASSWORD to .env
 *      (using existing values where already set)
 *   4. Drops tables/columns of features that were removed (see RETIRED_SCHEMA). Payload's
 *      dev push would otherwise stop at startup to ask about dropping them, and with no
 *      one to answer it exits — so this must run before the backend starts.
 *   5. Creates or updates Payload's tables. Payload only syncs its schema outside
 *      production (NODE_ENV=production skips it, and there are no migration files), so
 *      a one-off backend container does it in development mode, then exits.
 *
 * After running this script:
 *   docker compose up -d backend
 *   docker compose logs -f backend   # watch for "Payload: initialized"
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readEnvFile, upsertEnvVar } from './lib/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ok(msg)   { console.log(`  ✔  ${msg}`); }
function skip(msg) { console.log(`  –  ${msg} (already set)`); }
function step(msg) { console.log(`\n  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wait for payload-db
// ---------------------------------------------------------------------------

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForPayloadDb(dbUser, maxMs = 60_000) {
    const deadline = Date.now() + maxMs;
    process.stdout.write('\n  Waiting for payload-db to be ready');

    while (Date.now() < deadline) {
        try {
            // Runs pg_isready inside the payload-db container over the Docker network.
            // No host port mapping needed — docker compose exec works directly.
            execSync(
                `docker compose exec -T payload-db pg_isready -U ${dbUser} -d payload`,
                { cwd: ROOT, stdio: 'pipe' }
            );
            process.stdout.write('\n');
            return;
        } catch {
            // Container not up yet, or Postgres not accepting connections
        }
        process.stdout.write('.');
        await wait(3000);
    }

    process.stdout.write('\n');
    throw new Error(
        `payload-db did not become ready within ${maxMs / 1000}s.\n` +
        `  Make sure it is running: docker compose --profile payload up -d payload-db`
    );
}

// ---------------------------------------------------------------------------
// Seed .env vars
// ---------------------------------------------------------------------------

async function seedEnvVars(current) {
    step('.env config');

    const dbUser     = current.PAYLOAD_DB_USER     || 'payload';
    const dbPassword = current.PAYLOAD_DB_PASSWORD || 'payload-dev-password';
    const dbUri      = `postgresql://${dbUser}:${dbPassword}@payload-db:5432/payload`;

    const defaults = [
        ['PAYLOAD_DB_USER',     dbUser],
        ['PAYLOAD_DB_PASSWORD', dbPassword],
        ['PAYLOAD_DATABASE_URI', dbUri],
    ];

    for (const [key, value] of defaults) {
        if (!current[key]) {
            upsertEnvVar(ENV_FILE, key, value);
            ok(`${key} written to .env`);
        } else {
            skip(key);
        }
    }

    return dbUser;
}

async function ensurePayloadSecret(current) {
    step('Payload secret');
    if (current.PAYLOAD_SECRET) {
        skip('PAYLOAD_SECRET');
        return;
    }
    const secret = crypto.randomBytes(64).toString('hex');
    upsertEnvVar(ENV_FILE, 'PAYLOAD_SECRET', secret);
    ok('PAYLOAD_SECRET generated and written to .env');
}

// ---------------------------------------------------------------------------
// Retired schema
// ---------------------------------------------------------------------------

/**
 * Schema left by features that are gone (docs/redirect-login-and-sessions-design.md,
 * phase 7: the app's own password reset, registration completion and invite links).
 * IF EXISTS throughout, so this is a no-op on a fresh database or a second run.
 */
const RETIRED_SCHEMA = [
    'ALTER TABLE IF EXISTS payload_locked_documents_rels DROP COLUMN IF EXISTS password_reset_tokens_id',
    'DROP TABLE IF EXISTS password_reset_tokens CASCADE',
    'DROP TYPE IF EXISTS enum_password_reset_tokens_kind',
    'ALTER TABLE IF EXISTS case_invites DROP COLUMN IF EXISTS token_hash',
    'ALTER TABLE IF EXISTS registration_requests DROP COLUMN IF EXISTS completion_token_hash',
    'ALTER TABLE IF EXISTS registration_requests DROP COLUMN IF EXISTS completion_token_expires_at',
];

function dropRetiredSchema(dbUser) {
    step('Removing schema of retired features');
    const sql = RETIRED_SCHEMA.map((q) => `${q};`).join(' ');
    try {
        execSync(
            `docker compose exec -T payload-db psql -v ON_ERROR_STOP=1 -q -U ${dbUser} -d payload`,
            { cwd: ROOT, input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        ok('old password-reset table and invite/registration token columns are gone');
    } catch (err) {
        const detail = String(err.stderr || err.message || '').trim().split(/\r?\n/)[0];
        warn(`Could not remove retired schema (${detail}). The backend may stop at startup asking about it.`);
    }
}

/**
 * Payload's schema sync (dev push) is skipped when NODE_ENV=production, so on a
 * production server the backend would never create or update its tables. Do it here in
 * a one-off backend container, in development mode, with the backend's own config.
 */
function syncPayloadSchema() {
    step('Creating / updating Payload tables');
    const js = "import('/app/src/payload/index.js').then(async (m) => { await m.initPayload(); process.exit(0); })"
        + ".catch((e) => { console.error(e?.message || e); process.exit(1); })";
    const result = spawnSync('docker', [
        'compose', 'run', '--rm', '--no-deps', '-T', '-e', 'NODE_ENV=development', 'backend',
        'sh', '-c', `test -d node_modules/payload || npm ci >/dev/null; node -e "${js}"`,
    ], { cwd: ROOT, encoding: 'utf8' });
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    if (result.status === 0 && out.includes('Payload: initialized')) {
        ok('Payload tables match the backend collections');
        return;
    }
    // Payload exits on its own if a change would drop data and no one can confirm it.
    const tail = out.trim().split(/\r?\n/).slice(-15).join('\n');
    throw new Error(`Payload schema sync failed:\n${tail}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\nPayload CMS provisioning\n');

    const current = readEnvFile(ENV_FILE);

    // Seed env vars first so we know the DB user for the health check
    const dbUser = await seedEnvVars(current);
    await ensurePayloadSecret(current);

    await waitForPayloadDb(dbUser);
    ok('payload-db is healthy');

    dropRetiredSchema(dbUser);
    syncPayloadSchema();

    console.log(`
  ─────────────────────────────────────────────
  Done. payload-db is running and .env is set.

  Restart the backend to pick up the new vars:

    docker compose up -d backend
    docker compose logs -f backend

  Watch for: "Payload: initialized"

  Payload's tables (cases and attachments, case invites, groups, registration
  requests, notifications, user preferences, the site announcement) are in place.

  To enable the SlicerWeb developer channel (latest build) in the UI,
  add to .env (after credentials are configured):
    ENABLE_SLICERWEB_DEV_MODE=true
  ─────────────────────────────────────────────
`);
}

main().catch(err => {
    console.error(`\n  ✖  ${err.message}\n`);
    process.exit(1);
});
