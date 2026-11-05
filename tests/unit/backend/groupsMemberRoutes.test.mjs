import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// The member routes take both :groupId and :memberId from the URL but authorize on
// :groupId only, so they must also check that the membership row belongs to that group.
// Otherwise a manager of any group (and anyone can create one) could promote or remove
// memberships in other groups.

mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});
mock.module('../../../backend/src/payload/index.js', {
    namedExports: { getPayloadClient: () => null }
});
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        findUserByEmail: async () => null,
        getKeycloakUser: async () => null,
        kcDisplayName: () => '',
        getKeycloakSubForUser: () => null
    }
});
mock.module('../../../backend/src/services/caseGroupAccess.js', {
    namedExports: { removeGroupFromAllCases: async () => {} }
});

// members: memberId -> { id, groupId, kcSub, canManageGroup }
const store = { members: {}, calls: { update: [], remove: [] } };
mock.module('../../../backend/src/services/groupStore.js', {
    namedExports: {
        listGroups: async () => [],
        getGroup: async () => null,
        createGroup: async () => ({}),
        updateGroup: async () => ({}),
        deleteGroup: async () => {},
        addGroupMember: async () => ({}),
        removeGroupMember: async (id) => { store.calls.remove.push(id); },
        updateGroupMember: async (id, patch) => {
            store.calls.update.push({ id, patch });
            return { ...store.members[id], ...patch };
        },
        getGroupMemberById: async (id) => store.members[id] || null,
        getGroupsForUser: async (kcSub) => Object.values(store.members)
            .filter((m) => m.kcSub === kcSub)
            .map((m) => ({ group: { id: m.groupId }, canManageGroup: m.canManageGroup }))
    }
});

const groupRoutes = (await import('../../../backend/src/routes/groups.js')).default;

function makeApp() {
    const routes = [];
    const register = (method) => (path, ...handlers) => {
        const keys = [];
        const pattern = path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
        routes.push({ method, re: new RegExp(`^${pattern}$`), keys, handlers });
    };
    return {
        routes,
        get: register('GET'), post: register('POST'), put: register('PUT'),
        patch: register('PATCH'), delete: register('DELETE')
    };
}

function dispatch(app, method, path, { user, body } = {}) {
    const route = app.routes.find((r) => r.method === method && r.re.test(path));
    if (!route) throw new Error(`no route for ${method} ${path}`);
    const m = route.re.exec(path);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const req = { params, query: {}, body: body || {}, user, path, method };
    return new Promise((resolve) => {
        const res = {
            _status: 200,
            status(code) { this._status = code; return this; },
            json(b) { resolve({ status: this._status, body: b }); }
        };
        let i = 0;
        const next = (err) => {
            if (err) return resolve({ error: err });
            const handler = route.handlers[i++];
            if (!handler) return resolve({ error: new Error('no handler responded') });
            handler(req, res, next);
        };
        next();
    });
}

const app = makeApp();
groupRoutes(app);

// Mallory manages her own group "own"; she is a plain member of "target", where Alice manages.
const MALLORY = { id: 'u-m', role: 'user', keycloakSub: 'kc-mallory' };
const ORG_ADMIN = { id: 'u-o', role: 'org-admin', keycloakSub: 'kc-org' };

test.beforeEach(() => {
    store.members = {
        10: { id: '10', groupId: 'own', kcSub: 'kc-mallory', canManageGroup: true },
        20: { id: '20', groupId: 'target', kcSub: 'kc-mallory', canManageGroup: false },
        21: { id: '21', groupId: 'target', kcSub: 'kc-alice', canManageGroup: true },
        11: { id: '11', groupId: 'own', kcSub: 'kc-bob', canManageGroup: false }
    };
    store.calls = { update: [], remove: [] };
});

test('a manager cannot promote a membership that belongs to another group', async () => {
    const r = await dispatch(app, 'PATCH', '/api/my-groups/own/members/20', {
        user: MALLORY, body: { canManageGroup: true }
    });
    assert.equal(r.error?.statusCode, 404);
    assert.deepEqual(store.calls.update, []);
});

test('a manager cannot remove a membership that belongs to another group', async () => {
    const r = await dispatch(app, 'DELETE', '/api/my-groups/own/members/21', { user: MALLORY });
    assert.equal(r.error?.statusCode, 404);
    assert.deepEqual(store.calls.remove, []);
});

test('a manager can still update and remove members of their own group', async () => {
    const up = await dispatch(app, 'PATCH', '/api/my-groups/own/members/11', {
        user: MALLORY, body: { canManageGroup: true }
    });
    assert.equal(up.status, 200);
    assert.deepEqual(store.calls.update, [{ id: '11', patch: { canManageGroup: true } }]);

    const del = await dispatch(app, 'DELETE', '/api/my-groups/own/members/11', { user: MALLORY });
    assert.equal(del.status, 200);
    assert.deepEqual(store.calls.remove, ['11']);
});

test("the string 'false' revokes manage rights instead of granting them", async () => {
    store.members[11].canManageGroup = true;
    await dispatch(app, 'PATCH', '/api/my-groups/own/members/11', {
        user: MALLORY, body: { canManageGroup: 'false' }
    });
    assert.deepEqual(store.calls.update, [{ id: '11', patch: { canManageGroup: false } }]);
});

test('admin member routes also require the membership to be in the named group', async () => {
    const up = await dispatch(app, 'PATCH', '/api/admin/groups/own/members/21', {
        user: ORG_ADMIN, body: { canManageGroup: false }
    });
    assert.equal(up.error?.statusCode, 404);
    const del = await dispatch(app, 'DELETE', '/api/admin/groups/own/members/21', { user: ORG_ADMIN });
    assert.equal(del.error?.statusCode, 404);
    assert.deepEqual(store.calls.update, []);
    assert.deepEqual(store.calls.remove, []);
});
