import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import crypto from 'node:crypto';

// Approval gate (design doc rollout phase 3): an account needs app-user (or an admin
// role) to use SlicerHub. Existing accounts get app-user once, before the gate turns on;
// later accounts wait for a reviewer, who approves (grant) or rejects (delete).

process.env.AUTH_PROVIDER = 'keycloak';
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');

// ── Mocks for the registration routes ─────────────────────────────────────

const store = { requests: {}, calls: { markAccountApproved: [], rejectRequest: [] } };
mock.module('../../../backend/src/services/registrationRequestStore.js', {
    namedExports: {
        REG_STATUS: { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', COMPLETED: 'completed' },
        listPending: async () => [],
        listRecentlyDecided: async () => [],
        getById: async (id) => store.requests[id] || null,
        rejectRequest: async (...args) => { store.calls.rejectRequest.push(args); },
        markAccountApproved: async (...args) => { store.calls.markAccountApproved.push(args); },
    }
});
const kc = { calls: { assignRealmRole: [], deleteKeycloakUser: [], clearRegistrationAttributes: [] } };
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        assignRealmRole: async (id, role) => { kc.calls.assignRealmRole.push({ id, role }); },
        deleteKeycloakUser: async (id) => { kc.calls.deleteKeycloakUser.push(id); },
        clearRegistrationAttributes: async (id) => { kc.calls.clearRegistrationAttributes.push(id); },
        getUserAccountState: async () => ({}),
        getRealmAttributes: async () => ({}),
        setRealmAttributes: async () => {},
        listAllUserIds: async () => [],
        listRealmRoleMemberIds: async () => new Set(),
    }
});
const forgotten = [];
mock.module('../../../backend/src/auth/accountRefresh.js', {
    namedExports: { forgetAccount: (sub) => forgotten.push(sub), getCurrentAccount: async () => ({}) }
});
const mail = { approved: [] };
mock.module('../../../backend/src/services/mail.js', {
    namedExports: {
        sendRegistrationReceivedEmail: async () => {},
        sendAccessApprovedEmail: async (o) => { mail.approved.push(o); },
        isMailConfigured: () => true,
    }
});
mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});
mock.module('../../../backend/src/auth/requireKcGroupCapability.js', {
    namedExports: { requireKcGroupCapability: () => (req, res, next) => next() }
});
mock.module('../../../backend/src/services/groupCapabilities.js', {
    namedExports: { CAPABILITIES: { APPROVE_REGISTRATIONS: 'can_approve_registrations' } }
});
mock.module('../../../backend/src/services/registrationGroupNotifier.js', {
    namedExports: { notifyNewRequest: async () => {} }
});

const { hasAppAccess, resolveLocalUser } = await import('../../../backend/src/auth/providers/keycloak.js');
const gate = await import('../../../backend/src/services/appUserGate.js');
const registrationRequestRoutes = (await import('../../../backend/src/routes/registrationRequests.js')).default;

function makeApp() {
    const routes = [];
    const register = (method) => (path, ...handlers) => {
        const keys = [];
        const pattern = path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
        routes.push({ method, re: new RegExp(`^${pattern}$`), keys, handlers });
    };
    return { routes, get: register('GET'), post: register('POST') };
}
function dispatch(app, method, path, { user, body } = {}) {
    const route = app.routes.find((r) => r.method === method && r.re.test(path));
    const m = route.re.exec(path);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const req = { params, query: {}, body: body || {}, user, path, method, get: () => undefined, headers: {} };
    return new Promise((resolve) => {
        const res = {
            _status: 200,
            status(c) { this._status = c; return this; },
            json(b) { resolve({ status: this._status, body: b }); },
        };
        let i = 0;
        const next = (err) => {
            if (err) return resolve({ error: err });
            route.handlers[i++](req, res, next);
        };
        next();
    });
}
const app = makeApp();
registrationRequestRoutes(app);
const REVIEWER = { id: 'kc-rev', role: 'user', keycloakSub: 'kc-rev' };
const ORG_ADMIN = { id: 'kc-oa', role: 'org-admin', keycloakSub: 'kc-oa' };

test.beforeEach(() => {
    store.requests = {};
    for (const k of Object.keys(store.calls)) store.calls[k] = [];
    for (const k of Object.keys(kc.calls)) kc.calls[k] = [];
    forgotten.length = 0;
    mail.approved.length = 0;
});

// ── Who counts as approved ────────────────────────────────────────────────

test('app-user or an admin role passes the gate; no app role does not', () => {
    assert.equal(hasAppAccess(['app-user']), true);
    assert.equal(hasAppAccess(['app-org-admin']), true);
    assert.equal(hasAppAccess(['app-admin', 'offline_access']), true);
    assert.equal(hasAppAccess(['offline_access', 'uma_authorization']), false);
    assert.equal(hasAppAccess(undefined), false);
});

test('a signed-in account carries its approval state', () => {
    const base = { sub: 's', email: 'a@b.c' };
    assert.equal(resolveLocalUser({ ...base, roles: ['app-user'] }).approved, true);
    assert.equal(resolveLocalUser({ ...base, roles: [] }).approved, false);
});

// ── One-off grant before the gate turns on ────────────────────────────────

test('first run grants app-user to every existing account that lacks it, then marks the realm', async () => {
    gate._setGateReadyForTests(false);
    const granted = [];
    let marked = null;
    const n = await gate.ensureAppUserGrant({
        getRealmAttributes: async () => ({ other: 'kept' }),
        listAllUserIds: async () => ['a', 'b', 'c'],
        listRealmRoleMemberIds: async () => new Set(['b']),
        assignRealmRole: async (id, role) => granted.push(`${id}:${role}`),
        setRealmAttributes: async (patch) => { marked = patch; },
    });
    assert.equal(n, 2);
    assert.deepEqual(granted, ['a:app-user', 'c:app-user']);
    assert.ok(marked?.[gate.GATE_MARKER]);
    assert.equal(gate.isAppUserGateReady(), true);
});

test('once the realm is marked, nothing is granted again (new accounts wait for review)', async () => {
    gate._setGateReadyForTests(false);
    const granted = [];
    const n = await gate.ensureAppUserGrant({
        getRealmAttributes: async () => ({ [gate.GATE_MARKER]: '2026-11-06T00:00:00Z' }),
        listAllUserIds: async () => { throw new Error('should not list users'); },
        assignRealmRole: async (id) => granted.push(id),
    });
    assert.equal(n, 0);
    assert.deepEqual(granted, []);
    assert.equal(gate.isAppUserGateReady(), true);
});

test('if the grant fails, the gate stays open so existing users are not locked out', async () => {
    gate._setGateReadyForTests(false);
    await assert.rejects(gate.ensureAppUserGrant({
        getRealmAttributes: async () => ({}),
        listAllUserIds: async () => { throw new Error('Keycloak down'); },
        listRealmRoleMemberIds: async () => new Set(),
    }));
    assert.equal(gate.isAppUserGateReady(), false);
});

// ── Reviewer decisions on account requests ────────────────────────────────

test('approving an account request grants app-user, records it, and emails a sign-in link', async () => {
    store.requests['7'] = { id: '7', status: 'pending', email: 'dr@x.org', firstName: 'Ada', keycloakSub: 'kc-new' };
    const res = await dispatch(app, 'POST', '/api/admin/registration-requests/7/approve', { user: REVIEWER, body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(kc.calls.assignRealmRole, [{ id: 'kc-new', role: 'app-user' }]);
    assert.equal(store.calls.markAccountApproved.length, 1);
    assert.deepEqual(forgotten, ['kc-new']);
    assert.equal(mail.approved[0].to, 'dr@x.org');
    assert.ok(mail.approved[0].signInUrl);
    // Privacy: the account no longer needs the registration answers once decided.
    assert.deepEqual(kc.calls.clearRegistrationAttributes, ['kc-new']);
});

test('an org admin can approve an account as org admin; a plain reviewer cannot', async () => {
    store.requests['8'] = { id: '8', status: 'pending', email: 'x@x.org', keycloakSub: 'kc-8' };
    await dispatch(app, 'POST', '/api/admin/registration-requests/8/approve', { user: REVIEWER, body: { asAdmin: true } });
    assert.deepEqual(kc.calls.assignRealmRole.map((c) => c.role), ['app-user']);

    kc.calls.assignRealmRole = [];
    store.requests['8'].status = 'pending';
    await dispatch(app, 'POST', '/api/admin/registration-requests/8/approve', { user: ORG_ADMIN, body: { asAdmin: true } });
    assert.deepEqual(kc.calls.assignRealmRole.map((c) => c.role), ['app-user', 'app-org-admin']);
});

test('rejecting an account request deletes the Keycloak account', async () => {
    store.requests['9'] = { id: '9', status: 'pending', email: 'x@x.org', keycloakSub: 'kc-9' };
    const res = await dispatch(app, 'POST', '/api/admin/registration-requests/9/reject', { user: REVIEWER });
    assert.equal(res.status, 200);
    assert.deepEqual(kc.calls.deleteKeycloakUser, ['kc-9']);
    assert.equal(store.calls.rejectRequest.length, 1);
});

test('a leftover request from the old app-run sign-up (no account) cannot be approved, only rejected', async () => {
    store.requests['10'] = { id: '10', status: 'pending', email: 'f@x.org', keycloakSub: null };
    const res = await dispatch(app, 'POST', '/api/admin/registration-requests/10/approve', { user: REVIEWER, body: {} });
    assert.equal(res.error?.code, 'LEGACY_REQUEST');
    assert.deepEqual(kc.calls.assignRealmRole, []);
    assert.equal(store.calls.markAccountApproved.length, 0);

    store.requests['11'] = { id: '11', status: 'pending', email: 'g@x.org', keycloakSub: null };
    await dispatch(app, 'POST', '/api/admin/registration-requests/11/reject', { user: REVIEWER });
    assert.deepEqual(kc.calls.deleteKeycloakUser, []);
    assert.equal(store.calls.rejectRequest.length, 1);
});
