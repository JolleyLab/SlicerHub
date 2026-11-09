#!/usr/bin/env node
/**
 * Wait for the Payload admin UI, then create the first admin user via the
 * REST API.  The email is stored in .env (not sensitive); the password is
 * prompted once, used in the API call, and never written to disk.
 *
 * Idempotent — safe to re-run.  If the first user already exists the
 * create-first-user endpoint returns 403 and the script skips gracefully.
 */

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { readEnvFile, upsertEnvVar, prompt, promptSecret } from './lib/env.mjs';

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE   = path.join(__dirname, '..', '.env')
const ADMIN_PORT = 3001
const ADMIN_BASE = `http://localhost:${ADMIN_PORT}`

// ---------------------------------------------------------------------------
// .env helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Service readiness
// ---------------------------------------------------------------------------

async function waitForService(maxWaitSeconds = 180) {
    const deadline = Date.now() + maxWaitSeconds * 1000;
    process.stdout.write('  Waiting for payload-admin to start');
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${ADMIN_BASE}/admin`, {
                redirect: 'manual',
                signal: AbortSignal.timeout(5000),
            });
            if (res.status < 500) {
                process.stdout.write(' ready\n');
                return;
            }
        } catch {
            // not up yet
        }
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 3000));
    }
    process.stdout.write('\n');
    throw new Error(`payload-admin did not start within ${maxWaitSeconds}s`);
}

// ---------------------------------------------------------------------------
// First-user creation
// ---------------------------------------------------------------------------

async function ensureFirstUser() {
    const current = readEnvFile(ENV_FILE);
    // bootstrap.mjs collects this once (shared with the Keycloak admin account) and
    // passes it via env vars — never written to .env or any file. Only used as a
    // fallback, so running this script standalone still prompts as before.
    let email = (current.PAYLOAD_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim();

    console.log('\n  Payload admin user');

    if (!current.PAYLOAD_ADMIN_EMAIL) {
        if (!email) {
            email = await prompt('Admin email: ');
        }
        if (!email) {
            console.log('  –  Skipped (no email entered)');
            return;
        }
        upsertEnvVar(ENV_FILE, 'PAYLOAD_ADMIN_EMAIL', email);
        console.log(`  ✔  PAYLOAD_ADMIN_EMAIL written to .env`);
    } else {
        console.log(`  –  PAYLOAD_ADMIN_EMAIL already set (${email})`);
    }

    let password = (process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim();
    if (password.length >= 8) {
        console.log('  ✔  Using admin password from bootstrap.mjs');
    }
    while (password.length < 8) {
        password = await promptSecret('Admin password (min 8 chars): ');
        if (!password) {
            console.warn('  ⚠  No password entered — skipping user creation');
            return;
        }
        if (password.length >= 8) break;
        console.warn('  ⚠  Password must be at least 8 characters — try again');
    }

    const res = await fetch(`${ADMIN_BASE}/api/users/first-register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
    });

    if (res.status === 403 || res.status === 409) {
        console.log(`  –  First user already exists — skipping`);
        return;
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`first-register failed: HTTP ${res.status} — ${text}`);
    }

    console.log(`  ✔  Admin user "${email}" created`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\n━━  Payload admin setup');
    await waitForService();
    await ensureFirstUser();
    console.log(`
  ─────────────────────────────────────────────
  Done.  Payload admin is ready at ${ADMIN_BASE}/admin
  ─────────────────────────────────────────────
`);
}

main().catch(err => {
    console.error(`\n  ✖  ${err.message}`);
    process.exit(1);
});
