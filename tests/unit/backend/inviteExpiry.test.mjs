import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// Signup invites that are never taken up: the invite becomes expired and the Keycloak
// account made for it (with the email and case role) is removed if it was never set up.

const kc = { neverSetUp: new Set(), deleted: [], fail: false };
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        deleteAccountIfNeverSetUp: async (id) => {
            if (kc.fail) throw new Error('Keycloak down');
            if (!kc.neverSetUp.has(id)) return false;
            kc.deleted.push(id);
            return true;
        },
    }
});

const { expireStaleInvites, removeUnusedInviteeAccount } = await import('../../../backend/src/services/inviteExpiry.js');

const NOW = Date.parse('2026-11-06T12:00:00Z');
const hoursFrom = (h) => new Date(NOW + h * 3600 * 1000).toISOString();

/** Fake Payload over case-invites, supporting the where-clauses the service uses. */
function fakePayload(invites) {
    const rows = invites.map((r) => ({ ...r }));
    const test1 = (row, [key, cond]) => {
        if (key === 'and') return cond.every((c) => matches(row, c));
        if ('equals' in cond) return row[key] === cond.equals;
        if ('less_than' in cond) return row[key] != null && row[key] < cond.less_than;
        if ('greater_than' in cond) return row[key] != null && row[key] > cond.greater_than;
        throw new Error(`unsupported ${JSON.stringify(cond)}`);
    };
    const matches = (row, where) => Object.entries(where).every((e) => test1(row, e));
    return {
        rows,
        async find({ where, limit }) {
            const docs = rows.filter((r) => matches(r, where));
            return { docs: limit ? docs.slice(0, limit) : docs };
        },
        async update({ id, data }) {
            Object.assign(rows.find((r) => r.id === id), data);
        },
    };
}

test.beforeEach(() => {
    kc.neverSetUp = new Set();
    kc.deleted = [];
    kc.fail = false;
});

const quiet = async (fn) => {
    const { log, warn } = console;
    console.log = () => {}; console.warn = () => {};
    try { return await fn(); } finally { console.log = log; console.warn = warn; }
};

test('an expired signup invite is marked expired and its never-set-up account removed', async () => {
    kc.neverSetUp.add('kc-a');
    const payload = fakePayload([
        { id: 1, status: 'pending_signup', keycloak_user_id: 'kc-a', expires_at: hoursFrom(-1) },
    ]);
    await quiet(() => expireStaleInvites(payload, { now: NOW }));
    assert.equal(payload.rows[0].status, 'expired');
    assert.deepEqual(kc.deleted, ['kc-a']);
});

test('invites still within their time, or no longer waiting on sign-up, are left alone', async () => {
    kc.neverSetUp.add('kc-a');
    const payload = fakePayload([
        { id: 1, status: 'pending_signup', keycloak_user_id: 'kc-a', expires_at: hoursFrom(5) },
        { id: 2, status: 'accepted', keycloak_user_id: 'kc-a', expires_at: hoursFrom(-5) },
        { id: 3, status: 'pending_approval', expires_at: hoursFrom(-5) },
    ]);
    await quiet(() => expireStaleInvites(payload, { now: NOW }));
    assert.deepEqual(payload.rows.map((r) => r.status), ['pending_signup', 'accepted', 'pending_approval']);
    assert.deepEqual(kc.deleted, []);
});

test('an account someone has set up is kept even when an old invite to it expires', async () => {
    const payload = fakePayload([
        { id: 1, status: 'pending_signup', keycloak_user_id: 'kc-active', expires_at: hoursFrom(-1) },
    ]);
    await quiet(() => expireStaleInvites(payload, { now: NOW }));
    assert.equal(payload.rows[0].status, 'expired');
    assert.deepEqual(kc.deleted, []); // deleteAccountIfNeverSetUp said no
});

test('the account is kept while another signup invite (another case) is still waiting on it', async () => {
    kc.neverSetUp.add('kc-a');
    const payload = fakePayload([
        { id: 1, status: 'pending_signup', keycloak_user_id: 'kc-a', expires_at: hoursFrom(-1) },
        { id: 2, status: 'pending_signup', keycloak_user_id: 'kc-a', expires_at: hoursFrom(48) },
    ]);
    await quiet(() => expireStaleInvites(payload, { now: NOW }));
    assert.equal(payload.rows[0].status, 'expired');
    assert.deepEqual(kc.deleted, []);
    assert.equal(await removeUnusedInviteeAccount(payload, 'kc-a', { now: NOW }), false);
});

test('Keycloak being down does not stop the invites from expiring', async () => {
    kc.fail = true;
    const payload = fakePayload([
        { id: 1, status: 'pending_signup', keycloak_user_id: 'kc-a', expires_at: hoursFrom(-1) },
        { id: 2, status: 'pending_signup', keycloak_user_id: 'kc-b', expires_at: hoursFrom(-2) },
    ]);
    await quiet(() => expireStaleInvites(payload, { now: NOW }));
    assert.deepEqual(payload.rows.map((r) => r.status), ['expired', 'expired']);
});

test('does nothing without Payload or an account id', async () => {
    await assert.doesNotReject(expireStaleInvites(null));
    assert.equal(await removeUnusedInviteeAccount(null, 'kc-a'), false);
    assert.equal(await removeUnusedInviteeAccount(fakePayload([]), null), false);
});
