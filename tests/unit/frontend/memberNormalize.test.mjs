import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMember } from '../../../dev/utils/memberNormalize.js';

describe('normalizeMember', () => {
    it('preserves avatarUrl when present', () => {
        const result = normalizeMember({
            id: 'abc-123',
            email: 'user@example.com',
            username: 'User',
            avatarUrl: '/api/directus/users/abc-123/avatar',
            role: 'collaborator',
            locked: false
        });
        assert.equal(result.avatarUrl, '/api/directus/users/abc-123/avatar');
    });

    it('sets avatarUrl to null when not provided', () => {
        const result = normalizeMember({ id: 'abc-123', email: 'user@example.com' });
        assert.equal(result.avatarUrl, null);
    });

    it('sets avatarUrl to null for falsy values', () => {
        assert.equal(normalizeMember({ id: 'x', avatarUrl: '' }).avatarUrl, null);
        assert.equal(normalizeMember({ id: 'x', avatarUrl: null }).avatarUrl, null);
        assert.equal(normalizeMember({ id: 'x', avatarUrl: undefined }).avatarUrl, null);
    });

    it('forces role to admin for locked members regardless of input role', () => {
        const result = normalizeMember({ id: 'x', role: 'read_only', locked: true });
        assert.equal(result.role, 'admin');
        assert.equal(result.locked, true);
    });

    it('uses provided role for non-locked members', () => {
        assert.equal(normalizeMember({ id: 'x', role: 'read_only', locked: false }).role, 'read_only');
        assert.equal(normalizeMember({ id: 'x', role: 'collaborator' }).role, 'collaborator');
    });

    it('falls back to collaborator when role is missing', () => {
        assert.equal(normalizeMember({ id: 'x' }).role, 'collaborator');
    });

    it('coerces id to string', () => {
        assert.equal(normalizeMember({ id: 42 }).id, '42');
    });

    it('accepts snake_case first_name / last_name as fallback', () => {
        const result = normalizeMember({ id: 'x', first_name: 'Jane', last_name: 'Doe' });
        assert.equal(result.firstName, 'Jane');
        assert.equal(result.lastName, 'Doe');
    });

    it('prefers camelCase firstName over snake_case', () => {
        const result = normalizeMember({ id: 'x', firstName: 'Alice', first_name: 'Bob' });
        assert.equal(result.firstName, 'Alice');
    });
});
