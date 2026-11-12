/**
 * Module mocks shared by route tests that check case access: Payload (set `mocks.payload` to a
 * fakePayload per test), authentication (req.user is whatever the test passes), case roles
 * (owner → admin through the real caseAccess.js; others from `mocks.caseRoles`), Keycloak
 * display names, and notifications (collected in `mocks.notifications`).
 *
 * Import this before the route modules under test, and run with --experimental-test-module-mocks.
 */

import { mock } from 'node:test';

// caseAccess.js only asks Keycloak for case roles under this provider (read when config.js loads).
process.env.AUTH_PROVIDER = 'keycloak';

const src = (path) => new URL(`../../../../backend/src/${path}`, import.meta.url).href;

export const mocks = {
    payload: null,
    caseRoles: {},        // `${sub}:${caseId}` -> role
    names: {},            // sub -> display name
    notifications: [],    // what createNotification was called with
    reset(payload) {
        this.payload = payload;
        this.caseRoles = {};
        this.names = {};
        this.notifications = [];
    },
};

mock.module(src('payload/index.js'), {
    namedExports: {
        getPayloadClient: () => mocks.payload,
        requirePayload: (req, res, next) => (mocks.payload ? next() : res.status(503).json({})),
    },
});
mock.module(src('middleware/authMiddleware.js'), {
    namedExports: { authenticateToken: (req, res, next) => next() },
});
mock.module(src('services/keycloakAdmin.js'), {
    namedExports: {
        getUserCaseRole: async (sub, caseId) => mocks.caseRoles[`${sub}:${caseId}`] ?? null,
        getUserCaseRoleMap: async (sub) => Object.fromEntries(Object.entries(mocks.caseRoles)
            .filter(([key]) => key.startsWith(`${sub}:`))
            .map(([key, role]) => [key.slice(sub.length + 1), role])),
        getKeycloakUser: async (sub) => (mocks.names[sub] ? { preferredName: mocks.names[sub] } : null),
        kcDisplayName: (user, fallback = '') => user?.preferredName || fallback,
    },
});
mock.module(src('services/caseGroupAccess.js'), {
    namedExports: {
        getCaseRoleFromGroups: async () => null,
        getCaseRoleMapFromGroups: async () => ({}),
    },
});
mock.module(src('services/notifications.js'), {
    namedExports: {
        createNotification: async (n) => { mocks.notifications.push(n); return n; },
    },
});
