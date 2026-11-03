#!/usr/bin/env node
/**
 * Functional test: the real case-collaborator invite flow, against a live backend.
 *
 * Unlike tests/unit/, this makes real HTTP requests to a running server backed by real
 * Postgres/Payload and real Keycloak — no mocks. It exists to catch integration bugs the
 * mocked unit tests in tests/unit/backend/caseCollaboratorsRoute.test.mjs cannot: real
 * Payload schema/field mismatches, real Keycloak group semantics, real cookie-session auth.
 *
 * Requires the stack running: docker compose up backend payload-db payload-admin keycloak keycloak-db
 *
 * Credentials are never passed on the command line or read by the assistant — create
 * tests/functional/.env.local (already covered by the repo's `.env.*.local` gitignore
 * pattern) with:
 *   FUNC_BASE_URL=http://localhost:8000
 *   FUNC_ADMIN_USER=<existing account's username or email>
 *   FUNC_ADMIN_PASSWORD=<...>
 *   FUNC_COLLAB_USER=<a second existing account — optional>
 *   FUNC_COLLAB_PASSWORD=<...>
 *
 * Without FUNC_COLLAB_* the collaborator-side checks (read access while a member, 403 after
 * removal, collaborator-submitted invite) are skipped and only the admin-only checks run.
 *
 * Usage: node tests/functional/caseCollaborators.functional.mjs
 * (base URL, credentials: all from tests/functional/.env.local, not flags)
 *
 * Cleanup: every case/invite/collaborator-link this script creates is removed in a finally
 * block, best-effort, even if an assertion fails or throws.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLocalEnv() {
    const envPath = path.join(__dirname, '.env.local');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (process.env[key] === undefined) process.env[key] = value;
    }
}
loadLocalEnv();

const BASE_URL = process.env.FUNC_BASE_URL || 'http://localhost:8000';

class AssertionFailure extends Error {}
function assertTrue(cond, message) {
    if (!cond) throw new AssertionFailure(message);
}
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new AssertionFailure(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

/** A cookie-session HTTP client for one logged-in user. */
class Session {
    constructor(label) {
        this.label = label;
        this.cookie = '';
    }

    async login(identity, password) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity, password })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`[${this.label}] login failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
        }
        const setCookie = res.headers.getSetCookie?.() || [];
        this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
        if (!this.cookie) throw new Error(`[${this.label}] login succeeded but no session cookie was set`);
        this.user = body.user;
        return body;
    }

    /** @returns {Promise<{status: number, body: any}>} */
    async request(method, urlPath, { body } = {}) {
        const res = await fetch(`${BASE_URL}${urlPath}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(this.cookie ? { Cookie: this.cookie } : {})
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        let parsed = null;
        const text = await res.text();
        if (text) {
            try { parsed = JSON.parse(text); } catch { parsed = text; }
        }
        return { status: res.status, body: parsed };
    }

    /** Like request(), but throws with a readable message on an unexpected status. */
    async expect(method, urlPath, expectedStatus, opts = {}) {
        const result = await this.request(method, urlPath, opts);
        if (result.status !== expectedStatus) {
            throw new Error(
                `[${this.label}] ${method} ${urlPath} expected ${expectedStatus}, got ${result.status}: ${JSON.stringify(result.body)}`
            );
        }
        return result.body;
    }
}

async function main() {
    const results = [];
    const record = async (name, fn) => {
        try {
            await fn();
            results.push({ name, ok: true });
            console.log(`  ok  - ${name}`);
        } catch (err) {
            results.push({ name, ok: false, err });
            console.log(`FAIL  - ${name}`);
            console.log(`        ${err.message}`);
        }
    };

    const cleanup = []; // functions run LIFO in the finally block, best-effort
    const runCleanup = async () => {
        for (const fn of cleanup.reverse()) {
            try { await fn(); } catch (err) { console.warn('  cleanup step failed (continuing):', err.message); }
        }
    };

    const adminUser = process.env.FUNC_ADMIN_USER;
    const adminPassword = process.env.FUNC_ADMIN_PASSWORD;
    const collabUser = process.env.FUNC_COLLAB_USER;
    const collabPassword = process.env.FUNC_COLLAB_PASSWORD;

    if (!adminUser || !adminPassword) {
        console.error(
            'Missing FUNC_ADMIN_USER / FUNC_ADMIN_PASSWORD.\n'
            + 'Create tests/functional/.env.local — see the header comment in this file for the format.'
        );
        process.exit(2);
    }

    const admin = new Session('admin');
    let caseId;

    try {
        await record('admin logs in', async () => {
            await admin.login(adminUser, adminPassword);
            assertTrue(admin.user?.id != null, 'login response had no user');
        });

        await record('admin creates a case', async () => {
            const body = await admin.expect('POST', '/api/cases', 201, {
                body: { title: `Functional test case ${new Date().toISOString()}` }
            });
            caseId = body.case?.id;
            assertTrue(caseId != null, 'case creation did not return an id');
            cleanup.push(async () => {
                const res = await admin.request('DELETE', `/api/cases/${caseId}`);
                if (res.status !== 204) throw new Error(`cleanup: delete case returned ${res.status}`);
            });
        });

        await record('a fresh case has no collaborators', async () => {
            const body = await admin.expect('GET', `/api/cases/${caseId}/collaborators`, 200);
            assertEqual(body.collaborators.length, 0, 'collaborators');
            assertTrue(body.owner != null, 'owner');
        });

        if (collabUser && collabPassword) {
            const collab = new Session('collaborator');
            let collabId;

            await record('collaborator logs in', async () => {
                await collab.login(collabUser, collabPassword);
            });

            await record('collaborator cannot read the case before being added', async () => {
                const res = await collab.request('GET', `/api/cases/${caseId}/collaborators`);
                assertEqual(res.status, 403, 'status');
            });

            await record('admin adds the collaborator directly (known account)', async () => {
                const me = await collab.expect('GET', '/api/auth/me', 200);
                const collabEmail = me.user?.email;
                assertTrue(!!collabEmail, 'collaborator account has no email on file');

                const added = await admin.expect('POST', `/api/cases/${caseId}/invites`, 201, {
                    body: { email: collabEmail, role: 'collaborator' }
                });
                assertEqual(added.status, 'added', 'invite status');
                collabId = added.collaborator?.id;
                assertTrue(!!collabId, 'no collaborator id returned');
                cleanup.push(async () => {
                    await admin.request('DELETE', `/api/cases/${caseId}/collaborators/${collabId}`);
                });
            });

            await record('the collaborator now appears in the collaborator list with the right role', async () => {
                const body = await admin.expect('GET', `/api/cases/${caseId}/collaborators`, 200);
                const entry = body.collaborators.find((c) => c.id === collabId);
                assertTrue(!!entry, 'collaborator missing from list');
                assertEqual(entry.role, 'collaborator', 'role');
            });

            await record('the collaborator can now read the case', async () => {
                await collab.expect('GET', `/api/cases/${caseId}/collaborators`, 200);
            });

            await record('admin demotes the collaborator to read_only via bulk update', async () => {
                const body = await admin.expect('PUT', `/api/cases/${caseId}/collaborators`, 200, {
                    body: { collaborators: [{ id: collabId, role: 'read_only' }] }
                });
                const entry = body.collaborators.find((c) => c.id === collabId);
                assertEqual(entry?.role, 'read_only', 'role after demotion');
            });

            await record('a read_only collaborator can submit an invite that lands as pending_approval', async () => {
                const fakeEmail = `functional-test-${Date.now()}@example.invalid`;
                const invited = await collab.expect('POST', `/api/cases/${caseId}/invites`, 201, {
                    body: { email: fakeEmail, role: 'collaborator' }
                });
                assertEqual(invited.status, 'pending_approval', 'status');

                const list = await admin.expect('GET', `/api/cases/${caseId}/invites`, 200);
                const invite = list.invites.find((i) => i.inviteeEmail === fakeEmail);
                assertTrue(!!invite, 'admin cannot see the submitted invite');

                const rejected = await admin.expect(
                    'POST', `/api/cases/${caseId}/invites/${invite.id}/reject`, 200
                );
                assertEqual(rejected.status, 'rejected', 'reject status');
            });

            await record('admin removes the collaborator', async () => {
                await admin.expect('DELETE', `/api/cases/${caseId}/collaborators/${collabId}`, 204);
            });

            await record('the removed collaborator can no longer read the case', async () => {
                const res = await collab.request('GET', `/api/cases/${caseId}/collaborators`);
                assertEqual(res.status, 403, 'status');
            });
        } else {
            console.log('  (skipping collaborator-side checks — FUNC_COLLAB_USER/PASSWORD not set)');
        }
    } finally {
        console.log('\nCleaning up...');
        await runCleanup();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Functional test run failed:', err);
    process.exit(1);
});
