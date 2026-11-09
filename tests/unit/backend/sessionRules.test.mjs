import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import crypto from 'node:crypto';

// Session rules (design doc "Sessions"): 30 min idle where only real use counts, 12 h
// from sign-in, and procedure mode (exempt from both until it ends, then signed out).
// The SQLite session table is replaced by an in-memory fake.

process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.AUTH_PROVIDER = 'local'; // no Keycloak account checks in these tests

const rows = new Map(); // jti -> session row
const writes = [];
const dbTime = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19); // SQLite CURRENT_TIMESTAMP style
mock.module('../../../backend/src/db/database.js', {
    namedExports: { flushDatabase: () => {}, reloadDatabaseFromDisk: () => {} },
    defaultExport: {
        prepare(sql) {
            return {
                get(jti) {
                    if (/FROM sessions WHERE token_jti/.test(sql)) return rows.get(jti);
                    return undefined;
                },
                run(...args) {
                    writes.push({ sql, args });
                    if (/^DELETE FROM sessions WHERE token_jti/.test(sql.trim())) rows.delete(args[0]);
                    return { changes: 1 };
                },
            };
        },
    },
});
// Ending a session also ends its Keycloak sign-in (so a refresh asks for the password).
const endedKcSessions = [];
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        endKeycloakSession: async (sid) => { endedKcSessions.push(sid); },
        getUserAccountState: async () => ({ active: true }),
    },
});
mock.module('../../../backend/src/services/appUserGate.js', {
    namedExports: { isAppUserGateReady: () => false },
});

// The middleware starts an hourly session-cleanup interval at import; let it not keep the
// test process alive.
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const timer = realSetInterval(...args); timer.unref?.(); return timer; };

const jwt = (await import('../../../backend/node_modules/jsonwebtoken/index.js')).default;
const { authenticateToken } = await import('../../../backend/src/middleware/authMiddleware.js');
const { resolveProcedureRequest } = await import('../../../backend/src/auth/procedureMode.js');

const now = () => Date.now();
function session({ lastActivityMinutesAgo = 1, procedureUntil = null, signedInHoursAgo = 0 } = {}) {
    const jti = crypto.randomUUID();
    const iat = Math.floor((now() - signedInHoursAgo * 3600 * 1000) / 1000);
    const token = jwt.sign({ userId: 'u1', username: 'u', role: 'user', iat }, process.env.JWT_SECRET, { expiresIn: '30d', jwtid: jti });
    rows.set(jti, {
        id: 7,
        kc_sid: `kc-${jti}`,
        last_activity: dbTime(now() - lastActivityMinutesAgo * 60 * 1000),
        procedure_until: procedureUntil,
        procedure_open_ended: 0,
    });
    return { jti, token };
}
function run(token, path = '/api/cases') {
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, originalUrl: path, method: 'GET' };
    return new Promise((resolve) => authenticateToken(req, {}, (err) => resolve({ err, req })));
}

test.beforeEach(() => { writes.length = 0; endedKcSessions.length = 0; });

test('an active session passes, and an ordinary request does not count as activity', async () => {
    const { token } = session({ lastActivityMinutesAgo: 5 });
    const { err, req } = await run(token);
    assert.equal(err, undefined);
    assert.equal(req.user.id, 'u1');
    assert.deepEqual(endedKcSessions, [], 'an active session keeps its Keycloak sign-in');
    assert.equal(writes.some((w) => /last_activity/.test(w.sql)), false); // polling can't keep it alive
});

test('after 30 minutes without real use the session ends', async () => {
    const { token, jti } = session({ lastActivityMinutesAgo: 31 });
    const { err } = await run(token);
    assert.equal(err?.statusCode, 401);
    assert.equal(err?.code, 'SESSION_IDLE');
    assert.equal(rows.has(jti), false);
    assert.deepEqual(endedKcSessions, [`kc-${jti}`], 'the Keycloak sign-in ends too: a refresh asks for the password');
});

test('12 hours after sign-in the session ends, even with recent activity', async () => {
    const { token, jti } = session({ lastActivityMinutesAgo: 1, signedInHoursAgo: 12.5 });
    const { err } = await run(token);
    assert.equal(err?.code, 'SESSION_MAX_AGE');
    assert.deepEqual(endedKcSessions, [`kc-${jti}`]);
});

test('procedure mode: no idle timeout and no 12 h limit while it lasts', async () => {
    const until = new Date(now() + 3600 * 1000).toISOString();
    const { token } = session({ lastActivityMinutesAgo: 600, signedInHoursAgo: 14, procedureUntil: until });
    const { err, req } = await run(token);
    assert.equal(err, undefined);
    assert.equal(req.user.procedureUntil, until);
});

test('when procedure mode runs out the session ends (the workstation is not left signed in)', async () => {
    const { token, jti } = session({ procedureUntil: new Date(now() - 1000).toISOString() });
    const { err } = await run(token);
    assert.equal(err?.code, 'PROCEDURE_MODE_ENDED');
    assert.equal(rows.has(jti), false);
    assert.deepEqual(endedKcSessions, [`kc-${jti}`]);
});

test('procedure mode requires the acknowledgment and is capped at the site maximum (24 h hard cap)', () => {
    assert.throws(() => resolveProcedureRequest({ hours: 8 }), { code: 'PROCEDURE_MODE_ACK_REQUIRED' });
    const t0 = Date.parse('2026-11-06T08:00:00Z');
    const eight = resolveProcedureRequest({ hours: 8, acknowledged: true }, t0);
    assert.equal(eight.procedureUntil, '2026-11-06T16:00:00.000Z');
    assert.equal(eight.procedureOpenEnded, false);
    const tooLong = resolveProcedureRequest({ hours: 100, acknowledged: true }, t0);
    assert.equal(tooLong.hours, 24);
    const open = resolveProcedureRequest({ untilEnded: true, acknowledged: true }, t0);
    assert.equal(open.procedureOpenEnded, true);
    assert.equal(open.procedureUntil, '2026-11-07T08:00:00.000Z');
});
