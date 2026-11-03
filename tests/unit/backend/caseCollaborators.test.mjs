import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseCaseRole,
    toDisplayMember,
    listMembersByCaseIds,
    listMembersByCaseIdsAsUser,
    addCaseCreatorAsAdmin,
    CASE_COLLAB_ROLES
} from '../../../backend/src/services/caseCollaborators.js';

test('CASE_COLLAB_ROLES holds the three known role strings', () => {
    assert.deepEqual(CASE_COLLAB_ROLES, {
        ADMIN: 'admin',
        COLLABORATOR: 'collaborator',
        READ_ONLY: 'read_only'
    });
});

test('a stored role is exactly one of the three values; anything else is nothing', () => {
    assert.equal(parseCaseRole('admin'), 'admin');
    assert.equal(parseCaseRole('collaborator'), 'collaborator');
    assert.equal(parseCaseRole('read_only'), 'read_only');
    assert.equal(parseCaseRole('  admin  '), 'admin', 'surrounding whitespace is trimmed');
    for (const bad of [null, undefined, '', 'superuser', 'readonly', 'ADMIN', 1, ['admin']]) {
        assert.equal(parseCaseRole(bad), null, JSON.stringify(bad));
    }
});

test('toDisplayMember shows an unusable role as read only, the least access', () => {
    assert.equal(toDisplayMember({ id: 1, role: 'admin' }).role, 'admin');
    assert.equal(toDisplayMember({ id: 1, role: null }).role, 'read_only');
    assert.equal(toDisplayMember({ id: 1, role: '' }).role, 'read_only');
    assert.equal(toDisplayMember({ id: 1 }).role, 'read_only');
});

test('toDisplayMember copies the other member fields through unchanged', () => {
    const member = toDisplayMember({ id: 7, name: 'Dr. Lee', role: 'collaborator' });
    assert.deepEqual(member, { id: 7, name: 'Dr. Lee', role: 'collaborator' });
});

// These three are no-op stubs kept only so backend/src/services/directus.js (the legacy,
// mostly-dead Directus Cases code) keeps importing successfully. The contract — shape of the
// return value, not throwing — is what directus.js actually depends on.
test('legacy stubs keep the empty-collection shape callers destructure', async () => {
    assert.deepEqual(await listMembersByCaseIds(['case-1']), {});
    assert.deepEqual(await listMembersByCaseIdsAsUser(['case-1'], 'token'), {});
    assert.equal(await addCaseCreatorAsAdmin('case-1', 'user-1'), undefined);
});
