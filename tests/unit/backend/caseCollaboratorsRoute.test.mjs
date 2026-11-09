import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// routes/caseCollaborators.js is the live Payload+Keycloak collaborator/invite system (846
// lines) and, before this file, had zero test coverage. It talks directly to Payload,
// Keycloak admin, SlicerHub groups and SMTP rather than through injected dependencies, so
// those modules are replaced with controllable fakes before the route module is imported.
// requireKeycloak() in the route checks config.auth.provider === 'keycloak', so that must be
// set before config.js is first imported by anything.
process.env.AUTH_PROVIDER = 'keycloak';

let payloadClient = null;
mock.module('../../../backend/src/payload/index.js', {
    namedExports: {
        getPayloadClient: () => payloadClient,
        // Same as the real middleware, over the fake client.
        requirePayload: (req, res, next) => (payloadClient
            ? next()
            : res.status(503).json({ error: { message: 'Cases service not available' } })),
    }
});

mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});

const kc = {
    usersByEmail: {},   // email -> { id, email, ... } | undefined
    usersBySub: {},     // kcSub -> { firstName, lastName, username, email } | undefined
    collaborators: [],  // listCaseCollaborators() result
    userCaseRole: {},   // `${sub}:${caseId}` -> role | undefined (caseAccess.js fallback)
    caseRoleMap: {},    // sub -> { [caseId]: role } (pending-approval route)
    realmRoleUsers: {}, // realm role -> [{ id }]
    calls: { addUserToCaseGroup: [], removeUserFromAllCaseGroups: [], createKeycloakUser: [], assignRealmRole: [], createOptions: [], sendExecuteActionsEmail: [], prepareAccountSetup: [] },
    setupEmailFails: false,
    activeAccounts: new Set(), // ids prepareAccountSetup reports as already set up
};
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        CASE_ROLES: ['admin', 'collaborator', 'read_only'],
        findUserByEmail: async (email) => kc.usersByEmail[email] || null,
        addUserToCaseGroup: async (userId, caseId, role) => { kc.calls.addUserToCaseGroup.push({ userId, caseId, role }); },
        removeUserFromAllCaseGroups: async (userId, caseId) => { kc.calls.removeUserFromAllCaseGroups.push({ userId, caseId }); },
        listCaseCollaborators: async () => kc.collaborators,
        createKeycloakUser: async ({ email, requiredActions = null }) => {
            kc.calls.createKeycloakUser.push(email);
            kc.calls.createOptions.push({ email, requiredActions });
            const user = { id: `kc-new-${email}`, email };
            kc.usersByEmail[email] = user;
            return user;
        },
        assignRealmRole: async (id, role) => { kc.calls.assignRealmRole.push({ id, role }); },
        sendExecuteActionsEmail: async (id, actions, opts) => {
            if (kc.setupEmailFails) throw new Error('SMTP down');
            kc.calls.sendExecuteActionsEmail.push({ id, actions, opts });
        },
        prepareAccountSetup: async (id, actions) => {
            kc.calls.prepareAccountSetup.push({ id, actions });
            return !kc.activeAccounts.has(id);
        },
        getKeycloakUser: async (sub) => kc.usersBySub[sub] || null,
        getUserCaseRoleMap: async (sub) => kc.caseRoleMap[sub] || {},
        getUserCaseRole: async (sub, caseId) => kc.userCaseRole[`${sub}:${caseId}`] ?? null,
        getUsersWithRealmRole: async (role) => kc.realmRoleUsers[role] || [],
        kcDisplayName: (user) => {
            if (!user) return '';
            const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
            return user.preferredName || full || user.username || user.email || '';
        }
    }
});

const groupAccess = {
    byCase: {},        // caseId -> [{ groupId, role }]
    roleFromGroups: {}, // `${sub}:${caseId}` -> role
    roleMapFromGroups: {}, // sub -> { [caseId]: role }
    calls: { setGroupAccessForCase: [], removeGroupAccessForCase: [] }
};
mock.module('../../../backend/src/services/caseGroupAccess.js', {
    namedExports: {
        listGroupAccessForCase: async (caseId) => groupAccess.byCase[caseId] || [],
        setGroupAccessForCase: async (caseId, groupId, role) => {
            groupAccess.calls.setGroupAccessForCase.push({ caseId, groupId, role });
            const list = (groupAccess.byCase[caseId] = groupAccess.byCase[caseId] || []);
            const existing = list.find((g) => g.groupId === groupId);
            if (existing) existing.role = role; else list.push({ groupId, role });
        },
        removeGroupAccessForCase: async (caseId, groupId) => {
            groupAccess.calls.removeGroupAccessForCase.push({ caseId, groupId });
            groupAccess.byCase[caseId] = (groupAccess.byCase[caseId] || []).filter((g) => g.groupId !== groupId);
        },
        getCaseRoleFromGroups: async (sub, caseId) => groupAccess.roleFromGroups[`${sub}:${caseId}`] ?? null,
        getCaseRoleMapFromGroups: async (sub) => groupAccess.roleMapFromGroups[sub] || {}
    }
});

const groups = {}; // groupId -> { id, name, members: [{ kcSub }] }
mock.module('../../../backend/src/services/groupStore.js', {
    namedExports: { getGroup: async (id) => groups[id] || null }
});

// An invitee account never set up is removed when its invite is rejected or expires.
const unusedAccounts = { calls: [] };
mock.module('../../../backend/src/services/inviteExpiry.js', {
    namedExports: {
        removeUnusedInviteeAccount: async (_payload, id) => { unusedAccounts.calls.push(id); return true; },
    }
});

const caseCollaboratorsRoutes = (await import('../../../backend/src/routes/caseCollaborators.js')).default;

test.beforeEach(() => {
    payloadClient = null;
    kc.usersByEmail = {};
    kc.usersBySub = {};
    kc.collaborators = [];
    kc.userCaseRole = {};
    kc.caseRoleMap = {};
    kc.realmRoleUsers = {};
    for (const k of Object.keys(kc.calls)) kc.calls[k] = [];
    kc.setupEmailFails = false;
    kc.activeAccounts = new Set();
    groupAccess.byCase = {};
    groupAccess.roleFromGroups = {};
    groupAccess.roleMapFromGroups = {};
    for (const k of Object.keys(groupAccess.calls)) groupAccess.calls[k] = [];
    for (const k of Object.keys(groups)) delete groups[k];
    unusedAccounts.calls = [];
});

// --------------------------------------------------------------------------
// Minimal Express-like harness: register real route handlers, dispatch fake
// requests through them in order, same as Express would.
// --------------------------------------------------------------------------

function makeApp() {
    const routes = [];
    const register = (method) => (path, ...handlers) => {
        const keys = [];
        const pattern = path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
        routes.push({ method, re: new RegExp(`^${pattern}$`), keys, handlers });
    };
    return { routes, get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE') };
}

function dispatch(app, method, path, { user, body, query } = {}) {
    const candidate = app.routes.find((r) => r.method === method && r.re.test(path));
    if (!candidate) throw new Error(`no route for ${method} ${path}`);
    const m = candidate.re.exec(path);
    const params = {};
    candidate.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const req = { params, query: query || {}, body: body || {}, user, path, method };

    return new Promise((resolve) => {
        const res = {
            _status: 200,
            _headers: {},
            status(code) { this._status = code; return this; },
            set(k, v) { this._headers[k] = v; return this; },
            json(body) { resolve({ status: this._status, body }); },
            end() { resolve({ status: this._status, body: undefined }); }
        };
        let i = 0;
        const next = (err) => {
            if (err) return resolve({ error: err });
            const handler = candidate.handlers[i++];
            if (!handler) return resolve({ error: new Error('no handler responded') });
            handler(req, res, next);
        };
        next();
    });
}

const app = makeApp();
caseCollaboratorsRoutes(app);
const call = (method, path, opts) => dispatch(app, method, path, opts);

const ADMIN_USER = { id: 1, role: 'user', keycloakSub: 'kc-admin' };
const COLLAB_USER = { id: 2, role: 'user', keycloakSub: 'kc-collab' };
const SITE_ADMIN = { id: 3, role: 'admin', keycloakSub: 'kc-site-admin' };

function makeCase(overrides = {}) {
    return { id: '1', title: 'Cardiac CT', owner_id: 'kc-admin', ...overrides };
}

function fakePayload(initial = {}) {
    const data = { cases: [], 'case-invites': [], ...initial };
    let nextId = 500;
    // Payload's `where` ANDs every top-level key by default (not just the first), on top of
    // any explicit `and`/`or` combinators — both forms are used across the real route file.
    const matches = (row, where) => {
        return Object.entries(where).every(([key, cond]) => {
            if (key === 'and') return cond.every((c) => matches(row, c));
            if (key === 'or') return cond.some((c) => matches(row, c));
            if ('equals' in cond) return String(row[key]) === String(cond.equals);
            if ('in' in cond) return cond.in.map(String).includes(String(row[key]));
            return false;
        });
    };
    return {
        rows: data,
        async findByID({ collection, id }) {
            return (data[collection] || []).find((d) => String(d.id) === String(id)) || null;
        },
        async find({ collection, where, limit, sort }) {
            let docs = where ? (data[collection] || []).filter((d) => matches(d, where)) : [...(data[collection] || [])];
            if (sort) {
                const desc = sort.startsWith('-');
                const key = desc ? sort.slice(1) : sort;
                docs = [...docs].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
            }
            return { docs: limit ? docs.slice(0, limit) : docs, totalDocs: docs.length };
        },
        async create({ collection, data: fields }) {
            const doc = { id: nextId++, createdAt: new Date().toISOString(), ...fields };
            data[collection] = data[collection] || [];
            data[collection].push(doc);
            return doc;
        },
        async update({ collection, id, data: fields }) {
            const doc = (data[collection] || []).find((d) => String(d.id) === String(id));
            if (!doc) throw new Error('not found');
            Object.assign(doc, fields);
            return doc;
        },
        async delete({ collection, id }) {
            data[collection] = (data[collection] || []).filter((d) => String(d.id) !== String(id));
        }
    };
}

// --------------------------------------------------------------------------
// requirePayload / requireKeycloak gates
// --------------------------------------------------------------------------

test('every authenticated route 503s when Payload is not configured', async () => {
    payloadClient = null;
    const res = await call('GET', '/api/cases/1/collaborators', { user: ADMIN_USER });
    assert.equal(res.status, 503);
});

// --------------------------------------------------------------------------
// The app's own invite links are gone: Keycloak's emailed link sets the account up
// --------------------------------------------------------------------------

test('the old public invite-link endpoints no longer exist', () => {
    for (const path of ['/api/cases/invites/preview', '/api/cases/invites/redeem']) {
        assert.equal(app.routes.some((r) => r.re.test(path) && r.keys.length === 0), false, path);
    }
});

// --------------------------------------------------------------------------
// GET /api/cases/lookup-user
// --------------------------------------------------------------------------

test('lookup-user 404s when no account matches', async () => {
    payloadClient = fakePayload();
    const res = await call('GET', '/api/cases/lookup-user', { user: ADMIN_USER, query: { email: 'nobody@x.org' } });
    assert.equal(res.status, 404);
});

test('lookup-user rejects a value with no @', async () => {
    payloadClient = fakePayload();
    const res = await call('GET', '/api/cases/lookup-user', { user: ADMIN_USER, query: { email: 'not-an-email' } });
    assert.equal(res.error.statusCode, 400);
});

// --------------------------------------------------------------------------
// GET /api/cases/invites/pending-count and pending-approval
// --------------------------------------------------------------------------

test('pending-count is always 0 for a non-admin, without querying Payload', async () => {
    payloadClient = fakePayload({ 'case-invites': [{ id: 1, status: 'pending_approval' }] });
    const res = await call('GET', '/api/cases/invites/pending-count', { user: COLLAB_USER });
    assert.equal(res.body.count, 0);
});

test('pending-count reflects all pending_approval invites for a site admin', async () => {
    payloadClient = fakePayload({ 'case-invites': [
        { id: 1, status: 'pending_approval' },
        { id: 2, status: 'pending_approval' },
        { id: 3, status: 'accepted' }
    ] });
    const res = await call('GET', '/api/cases/invites/pending-count', { user: SITE_ADMIN });
    assert.equal(res.body.count, 2);
});

test('pending-approval lists invites only for cases the requester admins (KC role, group role, or ownership)', async () => {
    payloadClient = fakePayload({
        cases: [{ id: '1', owner_id: 'someone-else' }, { id: '2', owner_id: 'kc-admin' }],
        'case-invites': [
            { id: 1, case: '1', status: 'pending_approval', invitee_email: 'a@x.org', role: 'collaborator', inviter_id: 'kc-admin' },
            { id: 2, case: '2', status: 'pending_approval', invitee_email: 'b@x.org', role: 'collaborator', inviter_id: 'kc-admin' },
            { id: 3, case: '3', status: 'pending_approval', invitee_email: 'c@x.org', role: 'collaborator', inviter_id: 'kc-admin' }
        ]
    });
    kc.caseRoleMap['kc-admin'] = { '1': 'admin' };
    const res = await call('GET', '/api/cases/invites/pending-approval', { user: ADMIN_USER });
    assert.deepEqual(res.body.invites.map((i) => i.id).sort(), ['1', '2']);
});

// --------------------------------------------------------------------------
// GET /api/cases/:id/collaborators
// --------------------------------------------------------------------------

test('GET collaborators 404s for an unknown case', async () => {
    payloadClient = fakePayload();
    const res = await call('GET', '/api/cases/404/collaborators', { user: ADMIN_USER });
    assert.equal(res.error.statusCode, 404);
});

test('GET collaborators is forbidden for someone with no role on the case', async () => {
    payloadClient = fakePayload({ cases: [makeCase({ owner_id: 'someone-else' })] });
    const res = await call('GET', '/api/cases/1/collaborators', { user: COLLAB_USER });
    assert.equal(res.error.statusCode, 403);
});

test('GET collaborators merges individual Keycloak collaborators with SlicerHub group collaborators', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.collaborators = [{ id: 'kc-collab', email: 'c@x.org', role: 'collaborator' }];
    groups['g1'] = { id: 'g1', name: 'Radiology Team', members: [{ kcSub: 'kc-member-1' }] };
    groupAccess.byCase['1'] = [{ groupId: 'g1', role: 'read_only' }];
    const res = await call('GET', '/api/cases/1/collaborators', { user: ADMIN_USER });
    assert.equal(res.status, 200);
    const types = res.body.collaborators.map((c) => c.type);
    assert.deepEqual(types.sort(), ['group', 'user']);
    const group = res.body.collaborators.find((c) => c.type === 'group');
    assert.equal(group.id, 'group:g1');
    assert.equal(group.displayName, 'Radiology Team');
    assert.equal(group.role, 'read_only');
});

function groupWithMixedMembers() {
    groups['g1'] = { id: 'g1', name: 'Students', members: [
        { kcSub: 'kc-manager', canManageGroup: true },
        { kcSub: 'kc-orgadmin' },
        { kcSub: 'kc-sharer' },
        { kcSub: 'kc-private' },
    ] };
    groupAccess.byCase['1'] = [{ groupId: 'g1', role: 'read_only' }];
    kc.realmRoleUsers['app-org-admin'] = [{ id: 'kc-orgadmin' }];
    kc.usersBySub['kc-manager'] = { firstName: 'Mo', lastName: 'Manager', email: 'mo@x.org' };
    kc.usersBySub['kc-orgadmin'] = { firstName: 'Olu', lastName: 'Org', email: 'olu@x.org' };
    kc.usersBySub['kc-sharer'] = { preferredName: 'Sam', firstName: 'Samantha', email: 'sam@x.org' };
    kc.usersBySub['kc-private'] = { firstName: 'Pat', lastName: 'Private', email: 'pat@x.org' };
}

test('a case admin sees only group managers, org/site admins and members who share their name — never emails', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'user-preferences': [
            { id: 1, keycloak_sub: 'kc-sharer', share_name_in_groups: true },
            { id: 2, keycloak_sub: 'kc-private', share_name_in_groups: false },
        ]
    });
    groupWithMixedMembers();
    const res = await call('GET', '/api/cases/1/collaborators', { user: ADMIN_USER });
    const group = res.body.collaborators.find((c) => c.type === 'group');
    assert.deepEqual(group.members, [
        { id: 'kc-manager', displayName: 'Mo Manager' },
        { id: 'kc-orgadmin', displayName: 'Olu Org' },
        { id: 'kc-sharer', displayName: 'Sam' },
    ]);
    assert.equal(group.hiddenMemberCount, 1);
    assert.equal(group.memberCount, 4);
});

test('an org admin sees every group member with their email, to audit membership', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupWithMixedMembers();
    const res = await call('GET', '/api/cases/1/collaborators', { user: { id: 9, role: 'org-admin', keycloakSub: 'kc-some-org-admin' } });
    const group = res.body.collaborators.find((c) => c.type === 'group');
    assert.equal(group.hiddenMemberCount, 0);
    assert.deepEqual(group.members.find((m) => m.id === 'kc-private'), { id: 'kc-private', displayName: 'Pat Private', email: 'pat@x.org' });
});

test('a manager of the group sees every member by name', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupWithMixedMembers();
    groupAccess.roleFromGroups['kc-manager:1'] = 'read_only';
    const res = await call('GET', '/api/cases/1/collaborators', { user: { id: 8, role: 'user', keycloakSub: 'kc-manager' } });
    const group = res.body.collaborators.find((c) => c.type === 'group');
    assert.equal(group.hiddenMemberCount, 0);
    assert.equal(group.members.length, 4);
    assert.ok(group.members.every((m) => !('email' in m)));
});

test('GET collaborators includes the owner profile shape when the case has an owner', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.usersBySub['kc-admin'] = { email: 'owner@x.org', firstName: 'Ada', lastName: 'Lovelace' };
    const res = await call('GET', '/api/cases/1/collaborators', { user: ADMIN_USER });
    assert.equal(res.body.owner.id, 'kc-admin');
    assert.equal(res.body.owner.email, 'owner@x.org');
});

// --------------------------------------------------------------------------
// GET /api/cases/:id/invites — admin sees all, collaborator sees only their own
// --------------------------------------------------------------------------

test('a collaborator only sees invites they themselves submitted; an admin sees all', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [
            { id: 1, case: 1, status: 'pending_approval', invitee_email: 'a@x.org', role: 'collaborator', inviter_id: 'kc-admin', kind: 'existing' },
            { id: 2, case: 1, status: 'pending_approval', invitee_email: 'b@x.org', role: 'collaborator', inviter_id: 'kc-collab', kind: 'existing' }
        ]
    });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';

    const asCollab = await call('GET', '/api/cases/1/invites', { user: COLLAB_USER });
    assert.deepEqual(asCollab.body.invites.map((i) => i.id), [2]);

    const asAdmin = await call('GET', '/api/cases/1/invites', { user: ADMIN_USER });
    assert.deepEqual(asAdmin.body.invites.map((i) => i.id).sort(), [1, 2]);
});

// --------------------------------------------------------------------------
// POST /api/cases/:id/invites
// --------------------------------------------------------------------------

test('a read_only member cannot submit an invite', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const READ_ONLY_USER = { id: 9, role: 'user', keycloakSub: 'kc-reader' };
    groupAccess.roleFromGroups['kc-reader:1'] = 'read_only';
    const res = await call('POST', '/api/cases/1/invites', { user: READ_ONLY_USER, body: { email: 'x@x.org' } });
    assert.equal(res.error.statusCode, 403);
});

test('an admin inviting a known user adds them directly, with no invite record', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.usersByEmail['known@x.org'] = { id: 'kc-known', email: 'known@x.org' };
    const res = await call('POST', '/api/cases/1/invites', { user: ADMIN_USER, body: { email: 'known@x.org', role: 'collaborator' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'added');
    assert.deepEqual(kc.calls.addUserToCaseGroup[0], { userId: 'kc-known', caseId: '1', role: 'collaborator' });
    assert.equal(payloadClient.rows['case-invites'].length, 0);
});

test('an admin inviting a new email creates an account that must verify and set a password, and Keycloak emails the setup link', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const res = await call('POST', '/api/cases/1/invites', { user: ADMIN_USER, body: { email: 'new@x.org', role: 'read_only' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'signup_invite');
    assert.equal(res.body.emailSent, true);
    assert.equal(res.body.inviteUrl, undefined); // Keycloak's link only ever goes to the invitee
    assert.deepEqual(kc.calls.createOptions[0], { email: 'new@x.org', requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD'] });
    // A case admin's invite is the approval: the new account passes the approval gate.
    assert.deepEqual(kc.calls.assignRealmRole, [{ id: 'kc-new-new@x.org', role: 'app-user' }]);
    assert.deepEqual(kc.calls.addUserToCaseGroup[0], { userId: 'kc-new-new@x.org', caseId: '1', role: 'read_only' });
    assert.deepEqual(kc.calls.sendExecuteActionsEmail[0].actions, ['VERIFY_EMAIL', 'UPDATE_PASSWORD']);
    const invite = payloadClient.rows['case-invites'][0];
    assert.equal(invite.status, 'pending_signup');
    assert.equal('token_hash' in invite, false);
    assert.equal(invite.keycloak_user_id, 'kc-new-new@x.org');
    assert.ok(invite.expires_at, 'expires when the setup link does');
});

test('if Keycloak cannot send the setup email the inviter is told, without any link', async () => {
    kc.setupEmailFails = true;
    payloadClient = fakePayload({ cases: [makeCase()] });
    const original = console.warn;
    console.warn = () => {};
    try {
        const res = await call('POST', '/api/cases/1/invites', { user: ADMIN_USER, body: { email: 'new@x.org' } });
        assert.equal(res.body.emailSent, false);
        assert.ok(res.body.emailError);
        assert.equal(res.body.inviteUrl, undefined);
    } finally {
        console.warn = original;
    }
});

test('a collaborator inviting someone queues a pending_approval invite instead of acting immediately', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('POST', '/api/cases/1/invites', { user: COLLAB_USER, body: { email: 'x@x.org' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'pending_approval');
    assert.equal(kc.calls.addUserToCaseGroup.length, 0);
    assert.equal(payloadClient.rows['case-invites'][0].status, 'pending_approval');
});

test('a collaborator cannot propose admin access — it is silently capped to collaborator', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    await call('POST', '/api/cases/1/invites', { user: COLLAB_USER, body: { email: 'x@x.org', role: 'admin' } });
    assert.equal(payloadClient.rows['case-invites'][0].role, 'collaborator');
});

test('a collaborator cannot submit a second pending invite for the same email', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: 1, status: 'pending_approval', invitee_email: 'x@x.org', role: 'collaborator' }]
    });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('POST', '/api/cases/1/invites', { user: COLLAB_USER, body: { email: 'x@x.org' } });
    assert.equal(res.status, 409);
});

test('inviting the case owner is rejected — they already have admin access', async () => {
    // makeCase() defaults owner_id to ADMIN_USER's own sub, so ADMIN_USER has admin access as
    // owner; "owner@x.org" is that same owner's Keycloak account under a different email.
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.usersByEmail['owner@x.org'] = { id: 'kc-admin', email: 'owner@x.org' };
    const res = await call('POST', '/api/cases/1/invites', { user: ADMIN_USER, body: { email: 'owner@x.org' } });
    assert.equal(res.status, 409);
});

test('an invalid role is rejected before any Payload or Keycloak call', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const res = await call('POST', '/api/cases/1/invites', { user: ADMIN_USER, body: { email: 'x@x.org', role: 'superuser' } });
    assert.equal(res.error.statusCode, 400);
    assert.equal(kc.calls.addUserToCaseGroup.length, 0);
});

// --------------------------------------------------------------------------
// POST /api/cases/:id/group-invites
// --------------------------------------------------------------------------

test('an admin proposing a group links it to the case immediately', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groups['g1'] = { id: 'g1', name: 'Radiology Team', members: [{ kcSub: 'kc-admin' }] };
    const res = await call('POST', '/api/cases/1/group-invites', { user: ADMIN_USER, body: { groupId: 'g1', role: 'collaborator' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'added');
    assert.deepEqual(groupAccess.calls.setGroupAccessForCase[0], { caseId: '1', groupId: 'g1', role: 'collaborator' });
});

test('a collaborator proposing a group queues it for approval instead', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groups['g1'] = { id: 'g1', name: 'Radiology Team', members: [{ kcSub: 'kc-collab' }] };
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('POST', '/api/cases/1/group-invites', { user: COLLAB_USER, body: { groupId: 'g1' } });
    assert.equal(res.body.status, 'pending_approval');
    assert.equal(groupAccess.calls.setGroupAccessForCase.length, 0);
});

test('a case admin can link a group they are not a member of', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groups['g1'] = { id: 'g1', name: 'Students', members: [{ kcSub: 'kc-stranger' }] };
    const res = await call('POST', '/api/cases/1/group-invites', { user: ADMIN_USER, body: { groupId: 'g1' } });
    assert.equal(res.body.status, 'added');
});

test('proposing a group that does not exist 404s', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const res = await call('POST', '/api/cases/1/group-invites', { user: ADMIN_USER, body: { groupId: 'ghost' } });
    assert.equal(res.error.statusCode, 404);
});

test('proposing a group that is already linked to the case is rejected', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groups['g1'] = { id: 'g1', name: 'Radiology Team', members: [{ kcSub: 'kc-admin' }] };
    groupAccess.byCase['1'] = [{ groupId: 'g1', role: 'read_only' }];
    const res = await call('POST', '/api/cases/1/group-invites', { user: ADMIN_USER, body: { groupId: 'g1' } });
    assert.equal(res.status, 409);
});

// --------------------------------------------------------------------------
// POST /api/cases/:id/invites/:inviteId/approve and /reject
// --------------------------------------------------------------------------

test('approving an "existing" invite adds the user directly and marks the invite accepted', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'existing', invitee_email: 'x@x.org', role: 'collaborator', keycloak_user_id: 'kc-x' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.body.status, 'approved');
    assert.deepEqual(kc.calls.addUserToCaseGroup[0], { userId: 'kc-x', caseId: '1', role: 'collaborator' });
    assert.equal(payloadClient.rows['case-invites'][0].status, 'accepted');
});

test('approving a "group" invite links the group and marks the invite accepted', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'group', group_id: 'g1', role: 'read_only' }]
    });
    groups['g1'] = { id: 'g1', name: 'Radiology Team' };
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.body.status, 'approved');
    assert.deepEqual(groupAccess.calls.setGroupAccessForCase[0], { caseId: '1', groupId: 'g1', role: 'read_only' });
});

test('approving a group invite whose group was deleted deletes the request instead of linking', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'group', group_id: 'gone', role: 'read_only' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.status, 409);
    assert.equal(groupAccess.calls.setGroupAccessForCase.length, 0);
    assert.equal(payloadClient.rows['case-invites'].length, 0);
});

test('pending-approval includes the current members of a proposed group', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'group', group_id: 'g1', role: 'collaborator' }]
    });
    groups['g1'] = { id: 'g1', name: 'Radiology Team', members: [{ kcSub: 'kc-m1', canManageGroup: true }, { kcSub: 'kc-m2' }] };
    kc.usersBySub['kc-m1'] = { firstName: 'Ada', lastName: 'Lee' };
    const res = await call('GET', '/api/cases/invites/pending-approval', { user: ADMIN_USER });
    assert.deepEqual(res.body.invites[0].groupMembers, [{ id: 'kc-m1', displayName: 'Ada Lee' }]);
    assert.equal(res.body.invites[0].groupHiddenMemberCount, 1);
});

test('approving a "signup" invite creates the account and sends Keycloak account setup, moving status to pending_signup', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'signup', invitee_email: 'new@x.org', role: 'collaborator' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.body.status, 'signup_invite');
    assert.equal(kc.calls.sendExecuteActionsEmail.length, 1);
    assert.deepEqual(kc.calls.createOptions[0].requiredActions, ['VERIFY_EMAIL', 'UPDATE_PASSWORD']);
    assert.equal(payloadClient.rows['case-invites'][0].status, 'pending_signup');
    // Approved by the case admin, so the new account passes the approval gate.
    assert.deepEqual(kc.calls.assignRealmRole, [{ id: 'kc-new-new@x.org', role: 'app-user' }]);
});

test('approving an invite that is not pending_approval is rejected', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'accepted', kind: 'existing', invitee_email: 'x@x.org', role: 'collaborator' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.status, 409);
});

test('only a case admin can approve an invite', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'existing', invitee_email: 'x@x.org', role: 'collaborator' }]
    });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: COLLAB_USER });
    assert.equal(res.error.statusCode, 403);
});

test('rejecting a pending_signup invite revokes the Keycloak group membership it was already given', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_signup', kind: 'signup', invitee_email: 'x@x.org', role: 'collaborator', keycloak_user_id: 'kc-x' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/reject', { user: ADMIN_USER });
    assert.equal(res.body.status, 'rejected');
    assert.deepEqual(kc.calls.removeUserFromAllCaseGroups[0], { userId: 'kc-x', caseId: '1' });
    assert.equal(payloadClient.rows['case-invites'][0].status, 'rejected');
    // The account made for this invite goes too, if it was never set up.
    assert.deepEqual(unusedAccounts.calls, ['kc-x']);
});

test('rejecting a pending_approval invite does not touch Keycloak group membership (none was granted yet)', async () => {
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'existing', invitee_email: 'x@x.org', role: 'collaborator', keycloak_user_id: 'kc-x' }]
    });
    await call('POST', '/api/cases/1/invites/1/reject', { user: ADMIN_USER });
    assert.equal(kc.calls.removeUserFromAllCaseGroups.length, 0);
    assert.deepEqual(unusedAccounts.calls, []);
});

// --------------------------------------------------------------------------
// PUT /api/cases/:id/collaborators (bulk reconcile)
// --------------------------------------------------------------------------

test('bulk update adds new collaborators, changes roles, and removes ones no longer listed', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.collaborators = [
        { id: 'kc-keep-same-role', role: 'collaborator' },
        { id: 'kc-change-role', role: 'read_only' },
        { id: 'kc-remove-me', role: 'collaborator' }
    ];
    const res = await call('PUT', '/api/cases/1/collaborators', {
        user: ADMIN_USER,
        body: { collaborators: [
            { id: 'kc-keep-same-role', role: 'collaborator' },
            { id: 'kc-change-role', role: 'admin' },
            { id: 'kc-new-person', role: 'collaborator' }
        ] }
    });
    assert.equal(res.status, 200);
    assert.deepEqual(kc.calls.removeUserFromAllCaseGroups.map((c) => c.userId), ['kc-remove-me']);
    const added = kc.calls.addUserToCaseGroup.map((c) => c.userId).sort();
    assert.deepEqual(added, ['kc-change-role', 'kc-new-person']);
    // Unchanged role must not trigger a redundant group write.
    assert.ok(!kc.calls.addUserToCaseGroup.some((c) => c.userId === 'kc-keep-same-role'));
});

test('bulk update reconciles SlicerHub group entries the same way as individual users', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groups['g1'] = { id: 'g1', name: 'Team One' };
    groups['g2'] = { id: 'g2', name: 'Team Two', members: [{ kcSub: 'kc-admin' }] };
    groupAccess.byCase['1'] = [{ groupId: 'g1', role: 'read_only' }];
    const res = await call('PUT', '/api/cases/1/collaborators', {
        user: ADMIN_USER,
        body: { collaborators: [{ id: 'group:g2', role: 'collaborator' }] }
    });
    assert.equal(res.status, 200);
    assert.deepEqual(groupAccess.calls.removeGroupAccessForCase[0], { caseId: '1', groupId: 'g1' });
    assert.deepEqual(groupAccess.calls.setGroupAccessForCase[0], { caseId: '1', groupId: 'g2', role: 'collaborator' });
});

test('bulk update rejects an unknown group id before making any changes', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    kc.collaborators = [{ id: 'kc-a', role: 'collaborator' }];
    const res = await call('PUT', '/api/cases/1/collaborators', {
        user: ADMIN_USER,
        body: { collaborators: [{ id: 'group:ghost', role: 'collaborator' }] }
    });
    assert.equal(res.error.statusCode, 400);
    assert.equal(kc.calls.removeUserFromAllCaseGroups.length, 0);
});

test('bulk update rejects a non-array body and an invalid role', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const notArray = await call('PUT', '/api/cases/1/collaborators', { user: ADMIN_USER, body: { collaborators: 'nope' } });
    assert.equal(notArray.error.statusCode, 400);
    const badRole = await call('PUT', '/api/cases/1/collaborators', { user: ADMIN_USER, body: { collaborators: [{ id: 'kc-a', role: 'superuser' }] } });
    assert.equal(badRole.error.statusCode, 400);
});

test('only a case admin can bulk-update collaborators', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('PUT', '/api/cases/1/collaborators', { user: COLLAB_USER, body: { collaborators: [] } });
    assert.equal(res.error.statusCode, 403);
});

// --------------------------------------------------------------------------
// DELETE /api/cases/:id/collaborators/:collaboratorId
// --------------------------------------------------------------------------

test('deleting a plain id removes an individual from all case groups', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    const res = await call('DELETE', '/api/cases/1/collaborators/kc-someone', { user: ADMIN_USER });
    assert.equal(res.status, 204);
    assert.deepEqual(kc.calls.removeUserFromAllCaseGroups[0], { userId: 'kc-someone', caseId: '1' });
    assert.equal(groupAccess.calls.removeGroupAccessForCase.length, 0);
});

test('deleting a "group:" prefixed id removes the group\'s case access, not a Keycloak user', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupAccess.byCase['1'] = [{ groupId: 'g1', role: 'read_only' }];
    const res = await call('DELETE', '/api/cases/1/collaborators/group:g1', { user: ADMIN_USER });
    assert.equal(res.status, 204);
    assert.deepEqual(groupAccess.calls.removeGroupAccessForCase[0], { caseId: '1', groupId: 'g1' });
    assert.equal(kc.calls.removeUserFromAllCaseGroups.length, 0);
});

test('only a case admin can remove a collaborator', async () => {
    payloadClient = fakePayload({ cases: [makeCase()] });
    groupAccess.roleFromGroups['kc-collab:1'] = 'collaborator';
    const res = await call('DELETE', '/api/cases/1/collaborators/kc-someone', { user: COLLAB_USER });
    assert.equal(res.error.statusCode, 403);
});

// ── Keycloak account setup on approval ──────────────────────────────────────────

test('approving a signup invite for an account left disabled by the old invite flow re-enables it for Keycloak setup', async () => {
    kc.usersByEmail['old@x.org'] = { id: 'kc-old', email: 'old@x.org' };
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'signup', invitee_email: 'old@x.org', role: 'collaborator' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.body.status, 'signup_invite');
    assert.deepEqual(kc.calls.prepareAccountSetup[0], { id: 'kc-old', actions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD'] });
    assert.equal(kc.calls.createKeycloakUser.length, 0);
    assert.equal(kc.calls.sendExecuteActionsEmail.length, 1);
    assert.equal(payloadClient.rows['case-invites'][0].status, 'pending_signup');
});

test('approving a signup invite for someone who has since set up an account adds them, with no setup email or forced reset', async () => {
    kc.usersByEmail['now@x.org'] = { id: 'kc-active', email: 'now@x.org' };
    kc.activeAccounts.add('kc-active');
    payloadClient = fakePayload({
        cases: [makeCase()],
        'case-invites': [{ id: 1, case: '1', status: 'pending_approval', kind: 'signup', invitee_email: 'now@x.org', role: 'collaborator' }]
    });
    const res = await call('POST', '/api/cases/1/invites/1/approve', { user: ADMIN_USER });
    assert.equal(res.body.status, 'approved');
    assert.equal(kc.calls.sendExecuteActionsEmail.length, 0);
    assert.deepEqual(kc.calls.addUserToCaseGroup[0], { userId: 'kc-active', caseId: '1', role: 'collaborator' });
    assert.equal(payloadClient.rows['case-invites'][0].status, 'accepted');
});
