import test from 'node:test';
import assert from 'node:assert/strict';
import { toRegistrationRequestDTO as mapRequest, REG_STATUS } from '../../../backend/src/services/registrationRequestStore.js';

test('REG_STATUS has correct values', () => {
    assert.equal(REG_STATUS.PENDING,   'pending');
    assert.equal(REG_STATUS.APPROVED,  'approved');
    assert.equal(REG_STATUS.REJECTED,  'rejected');
    assert.equal(REG_STATUS.COMPLETED, 'completed');
});

test('REG_STATUS is frozen', () => {
    assert.throws(() => { REG_STATUS.PENDING = 'mutated'; }, TypeError);
});

test('mapRequest returns null for null input', () => {
    assert.equal(mapRequest(null), null);
});

test('mapRequest returns null for undefined input', () => {
    assert.equal(mapRequest(undefined), null);
});

test('mapRequest maps all standard fields', () => {
    const row = {
        id: 'abc-123',
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        affiliation: 'Queens University',
        intended_use: 'Clinical research',
        status: 'pending',
        is_org_admin: false,
        createdAt: '2026-01-15T10:00:00Z'
    };
    const result = mapRequest(row);
    assert.equal(result.id, 'abc-123');
    assert.equal(result.email, 'jane@example.com');
    assert.equal(result.firstName, 'Jane');
    assert.equal(result.lastName, 'Doe');
    assert.equal(result.affiliation, 'Queens University');
    assert.equal(result.intendedUse, 'Clinical research');
    assert.equal(result.status, 'pending');
    assert.equal(result.isOrgAdmin, false);
    assert.equal(result.createdAt, '2026-01-15T10:00:00Z');
});

test('mapRequest coerces id to string', () => {
    const result = mapRequest({ id: 42, email: 'x@x.com' });
    assert.equal(result.id, '42');
});

test('mapRequest sets isOrgAdmin true when is_org_admin is true', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com', is_org_admin: true });
    assert.equal(result.isOrgAdmin, true);
});

test('mapRequest sets isOrgAdmin false for null', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com', is_org_admin: null }).isOrgAdmin, false);
});

test('mapRequest sets isOrgAdmin false when field is absent', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).isOrgAdmin, false);
});

test('mapRequest defaults status to PENDING when absent', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.status, REG_STATUS.PENDING);
});

test('mapRequest defaults missing string fields to empty string', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.firstName, '');
    assert.equal(result.lastName, '');
    assert.equal(result.affiliation, '');
    assert.equal(result.intendedUse, '');
});

test('mapRequest sets createdAt to null when absent', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.createdAt, null);
});

test('mapRequest sets decidedAt from reviewed_at', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com', reviewed_at: '2026-03-01T12:00:00Z' });
    assert.equal(result.decidedAt, '2026-03-01T12:00:00Z');
});

test('mapRequest sets decidedAt to null when reviewed_at is absent', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).decidedAt, null);
});

test('mapRequest sets reviewerName to null (resolved separately from Keycloak)', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).reviewerName, null);
});
