import test from 'node:test';
import assert from 'node:assert/strict';

// Small security fixes that are easiest to check directly against the helpers.

const { resolvePayloadSecret } = await import('../../../backend/src/payload/secret.js');
const { getCurrentAccount, forgetAccount, REFRESH_MS } = await import('../../../backend/src/auth/accountRefresh.js');

// ── PAYLOAD_SECRET ─────────────────────────────────────────────────────────

test('Payload refuses a missing or default secret when Payload is enabled', () => {
    const db = 'postgres://x';
    assert.throws(() => resolvePayloadSecret({ PAYLOAD_DATABASE_URI: db }), /PAYLOAD_SECRET/);
    assert.throws(
        () => resolvePayloadSecret({ PAYLOAD_DATABASE_URI: db, PAYLOAD_SECRET: 'dev-secret-please-change' }),
        /PAYLOAD_SECRET/
    );
    assert.equal(resolvePayloadSecret({ PAYLOAD_DATABASE_URI: db, PAYLOAD_SECRET: 'a'.repeat(64) }), 'a'.repeat(64));
});

test('Payload secret is not required when Payload is not configured', () => {
    assert.doesNotThrow(() => resolvePayloadSecret({}));
});

// ── Keycloak role refresh ──────────────────────────────────────────────────

test('a demotion in Keycloak replaces the login-time role', async () => {
    forgetAccount();
    const fetchState = async () => ({ exists: true, enabled: true, realmRoles: ['app-org-admin'] });
    assert.deepEqual(await getCurrentAccount('sub-1', { fetchState }), { active: true, role: 'org-admin' });
});

test('a disabled or deleted account is reported inactive', async () => {
    forgetAccount();
    const disabled = async () => ({ exists: true, enabled: false, realmRoles: ['app-admin'] });
    assert.equal((await getCurrentAccount('sub-2', { fetchState: disabled })).active, false);
    const gone = async () => ({ exists: false, enabled: false, realmRoles: [] });
    assert.equal((await getCurrentAccount('sub-3', { fetchState: gone })).active, false);
});

test('Keycloak is asked at most once per refresh interval per user', async () => {
    forgetAccount();
    let calls = 0;
    const fetchState = async () => { calls++; return { exists: true, enabled: true, realmRoles: [] }; };
    await Promise.all([
        getCurrentAccount('sub-4', { fetchState }),
        getCurrentAccount('sub-4', { fetchState }),
    ]);
    await getCurrentAccount('sub-4', { fetchState });
    assert.equal(calls, 1);
    assert.ok(REFRESH_MS > 0);
});

test('when Keycloak is unreachable the state is unknown, not inactive (no mass logout)', async () => {
    forgetAccount();
    const original = console.warn;
    console.warn = () => {};
    try {
        const failing = async () => { throw new Error('ECONNREFUSED'); };
        assert.deepEqual(await getCurrentAccount('sub-5', { fetchState: failing }), { active: null, role: null });
    } finally {
        console.warn = original;
    }
});
