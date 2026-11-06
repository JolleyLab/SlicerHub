#!/usr/bin/env node
/**
 * Payload CMS + Postgres provisioning script.
 *
 * Run after: docker compose --profile payload up -d payload-db
 *
 *   node scripts/setup-payload.mjs
 *
 * Idempotent — safe to re-run. Does NOT contact Payload itself;
 * Payload runs its own migrations on first backend start.
 *
 * What this script does:
 *   1. Waits for payload-db (Postgres) to accept connections
 *   2. Generates PAYLOAD_SECRET if not already in .env
 *   3. Writes PAYLOAD_DATABASE_URI, PAYLOAD_DB_USER, PAYLOAD_DB_PASSWORD to .env
 *      (using existing values where already set)
 *   4. Drops tables/columns of features that were removed (see RETIRED_SCHEMA). Payload's
 *      dev push would otherwise stop at startup to ask about dropping them, and with no
 *      one to answer it exits — so this must run before the backend starts.
 *
 * After running this script:
 *   docker compose up -d backend
 *   docker compose logs -f backend   # watch for "Payload: initialized"
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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

    console.log(`
  ─────────────────────────────────────────────
  Done. payload-db is running and .env is set.

  Restart the backend to pick up the new vars
  and let Payload run its migrations:

    docker compose up -d backend
    docker compose logs -f backend

  Watch for: "Payload: initialized — Cases, UserPreferences, TaskGroups collections ready"

  Collections (all auto-migrated by Payload on first backend start):
    user-preferences      — per-user UI preferences (theme, viewer mode, SlicerWeb
                            channel). Keyed by Keycloak sub.
    task-groups           — task groups with canApproveRegistrations capability flag.
    task-group-members    — group membership keyed by Keycloak sub.

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
