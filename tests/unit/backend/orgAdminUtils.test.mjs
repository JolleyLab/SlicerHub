import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrgAdminByRole } from '../../../backend/src/auth/orgAdminUtils.js';

// --- raw role object form (from findDirectusUserById) ---

test('returns true for role name OrgAdmin', () => {
    assert.equal(isOrgAdminByRole({ name: 'OrgAdmin' }), true);
});

test('returns true for role name Administrator', () => {
    assert.equal(isOrgAdminByRole({ name: 'Administrator' }), true);
});

test('returns false for other role names', () => {
    assert.equal(isOrgAdminByRole({ name: 'Clinician' }), false);
    assert.equal(isOrgAdminByRole({ name: 'Employee' }), false);
});

test('returns false for null', () => {
    assert.equal(isOrgAdminByRole(null), false);
});

test('returns false for undefined', () => {
    assert.equal(isOrgAdminByRole(undefined), false);
});

// --- fetchDirectusCurrentUser result form (has roleName property) ---

test('returns true when roleName is OrgAdmin', () => {
    assert.equal(isOrgAdminByRole({ roleName: 'OrgAdmin', roleId: 'some-id' }), true);
});

test('returns true when roleName is Administrator', () => {
    assert.equal(isOrgAdminByRole({ roleName: 'Administrator', roleId: 'some-id' }), true);
});

test('returns false when roleName is a regular role', () => {
    assert.equal(isOrgAdminByRole({ roleName: 'Clinician', roleId: 'some-id' }), false);
});

test('returns false when roleName is null', () => {
    assert.equal(isOrgAdminByRole({ roleName: null, roleId: 'some-id' }), false);
});

test('returns false when roleName is empty string', () => {
    assert.equal(isOrgAdminByRole({ roleName: '', roleId: 'some-id' }), false);
});
