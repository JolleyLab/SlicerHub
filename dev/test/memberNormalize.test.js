import { describe, it, expect } from 'vitest';
import { normalizeMember } from '../utils/memberNormalize.js';

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
        expect(result.avatarUrl).toBe('/api/directus/users/abc-123/avatar');
    });

    it('sets avatarUrl to null when not provided', () => {
        const result = normalizeMember({ id: 'abc-123', email: 'user@example.com' });
        expect(result.avatarUrl).toBeNull();
    });

    it('sets avatarUrl to null for falsy values', () => {
        expect(normalizeMember({ id: 'x', avatarUrl: '' }).avatarUrl).toBeNull();
        expect(normalizeMember({ id: 'x', avatarUrl: null }).avatarUrl).toBeNull();
        expect(normalizeMember({ id: 'x', avatarUrl: undefined }).avatarUrl).toBeNull();
    });

    it('forces role to admin for locked members regardless of input role', () => {
        const result = normalizeMember({ id: 'x', role: 'read_only', locked: true });
        expect(result.role).toBe('admin');
        expect(result.locked).toBe(true);
    });

    it('uses provided role for non-locked members', () => {
        expect(normalizeMember({ id: 'x', role: 'read_only', locked: false }).role).toBe('read_only');
        expect(normalizeMember({ id: 'x', role: 'collaborator' }).role).toBe('collaborator');
    });

    it('falls back to collaborator when role is missing', () => {
        expect(normalizeMember({ id: 'x' }).role).toBe('collaborator');
    });

    it('coerces id to string', () => {
        expect(normalizeMember({ id: 42 }).id).toBe('42');
    });

    it('accepts snake_case first_name / last_name as fallback', () => {
        const result = normalizeMember({ id: 'x', first_name: 'Jane', last_name: 'Doe' });
        expect(result.firstName).toBe('Jane');
        expect(result.lastName).toBe('Doe');
    });

    it('prefers camelCase firstName over snake_case', () => {
        const result = normalizeMember({ id: 'x', firstName: 'Alice', first_name: 'Bob' });
        expect(result.firstName).toBe('Alice');
    });
});
