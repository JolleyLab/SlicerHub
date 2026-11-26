import test from 'node:test';
import assert from 'node:assert/strict';
import { mocks } from './helpers/caseRouteMocks.mjs';
import { fakePayload } from './helpers/routeHarness.mjs';

const { getCaseRole, getCaseRoleForSub, buildCaseRoleMap } = await import('../../../backend/src/utils/caseAccess.js');

const caseDoc = { id: 1, owner_id: 'kc-owner' };
test.beforeEach(() => mocks.reset(fakePayload({ cases: [caseDoc] })));

test('only app-admin is admin on every case; an org admin has only their membership', async () => {
    assert.equal(await getCaseRole(caseDoc, { user: { role: 'admin', keycloakSub: 'kc-site' } }), 'admin');
    assert.equal(await getCaseRole(caseDoc, { user: { role: 'org-admin', keycloakSub: 'kc-org' } }), null);
    mocks.caseRoles['kc-org:1'] = 'read_only';
    assert.equal(await getCaseRole(caseDoc, { user: { role: 'org-admin', keycloakSub: 'kc-org' } }), 'read_only');
});

test("a site_admin membership is admin while they're a site admin, read only after", async () => {
    mocks.caseRoles['kc-site:1'] = 'site_admin';
    mocks.caseRoles['kc-former:1'] = 'site_admin';
    mocks.siteAdmins.add('kc-site');
    // Others asking (a mention, a request outcome): checked against the live role.
    assert.equal(await getCaseRoleForSub(caseDoc, 'kc-site'), 'admin');
    assert.equal(await getCaseRoleForSub(caseDoc, 'kc-former'), 'read_only');
    // The former site admin themselves: read only, in the case and in their list.
    assert.equal(await getCaseRole(caseDoc, { user: { role: 'user', keycloakSub: 'kc-former' } }), 'read_only');
    assert.deepEqual(await buildCaseRoleMap({ user: { role: 'user', keycloakSub: 'kc-former' } }), { 1: 'read_only' });
});
