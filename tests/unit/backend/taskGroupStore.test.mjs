import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGroup, mapMember, wouldEmptyCapabilityGroup } from '../../../backend/src/services/groupStore.js';

// ---------------------------------------------------------------------------
// mapGroup
// ---------------------------------------------------------------------------

test('mapGroup returns null for null', () => {
    assert.equal(mapGroup(null), null);
});

test('mapGroup returns null for undefined', () => {
    assert.equal(mapGroup(undefined), null);
});

test('mapGroup maps all standard fields', () => {
    const doc = {
        id: 7,
        name: 'Reviewers',
        description: 'Can approve registrations',
        can_approve_registrations: true,
        createdAt: '2026-01-01T00:00:00Z',
    };
    const g = mapGroup(doc);
    assert.equal(g.id, '7');
    assert.equal(g.name, 'Reviewers');
    assert.equal(g.description, 'Can approve registrations');
    assert.equal(g.canApproveRegistrations, true);
    assert.equal(g.createdAt, '2026-01-01T00:00:00Z');
});

test('mapGroup coerces id to string', () => {
    assert.equal(mapGroup({ id: 42, name: 'x' }).id, '42');
});

test('mapGroup defaults missing fields', () => {
    const g = mapGroup({ id: 1 });
    assert.equal(g.name, '');
    assert.equal(g.description, '');
    assert.equal(g.canApproveRegistrations, false);
    assert.equal(g.createdAt, null);
});

test('mapGroup treats falsy can_approve_registrations as false', () => {
    assert.equal(mapGroup({ id: 1, can_approve_registrations: 0 }).canApproveRegistrations, false);
    assert.equal(mapGroup({ id: 1, can_approve_registrations: null }).canApproveRegistrations, false);
});

test('mapGroup treats truthy can_approve_registrations as true', () => {
    assert.equal(mapGroup({ id: 1, can_approve_registrations: 1 }).canApproveRegistrations, true);
});

// ---------------------------------------------------------------------------
// mapMember
// ---------------------------------------------------------------------------

test('mapMember returns null for null', () => {
    assert.equal(mapMember(null), null);
});

test('mapMember returns null for undefined', () => {
    assert.equal(mapMember(undefined), null);
});

test('mapMember maps all standard fields', () => {
    const doc = {
        id: 3,
        kc_sub: 'abc-123',
        can_manage_group: true,
        createdAt: '2026-02-01T00:00:00Z',
    };
    const m = mapMember(doc);
    assert.equal(m.id, '3');
    assert.equal(m.kcSub, 'abc-123');
    assert.equal(m.canManageGroup, true);
    assert.equal(m.createdAt, '2026-02-01T00:00:00Z');
});

test('mapMember coerces id to string', () => {
    assert.equal(mapMember({ id: 99, kc_sub: 'x' }).id, '99');
});

test('mapMember defaults missing fields', () => {
    const m = mapMember({ id: 1 });
    assert.equal(m.kcSub, '');
    assert.equal(m.canManageGroup, false);
    assert.equal(m.createdAt, null);
});

// ---------------------------------------------------------------------------
// wouldEmptyCapabilityGroup
// ---------------------------------------------------------------------------

function makeGroup(overrides = {}) {
    return {
        id: '1',
        name: 'Registration Reviewers',
        canApproveRegistrations: true,
        members: [{ id: '10' }, { id: '11' }],
        ...overrides,
    };
}

test('wouldEmptyCapabilityGroup: returns false for non-capability group', () => {
    const group = makeGroup({ canApproveRegistrations: false, members: [{ id: '10' }] });
    assert.equal(wouldEmptyCapabilityGroup(group, '10'), false);
});

test('wouldEmptyCapabilityGroup: returns false when null group', () => {
    assert.equal(wouldEmptyCapabilityGroup(null, '10'), false);
});

test('wouldEmptyCapabilityGroup: returns false when group has 2+ members', () => {
    const group = makeGroup({ members: [{ id: '10' }, { id: '11' }] });
    assert.equal(wouldEmptyCapabilityGroup(group, '10'), false);
});

test('wouldEmptyCapabilityGroup: returns true when removing the only member', () => {
    const group = makeGroup({ members: [{ id: '10' }] });
    assert.equal(wouldEmptyCapabilityGroup(group, '10'), true);
});

test('wouldEmptyCapabilityGroup: returns true when memberId is a number matching string id', () => {
    const group = makeGroup({ members: [{ id: '10' }] });
    assert.equal(wouldEmptyCapabilityGroup(group, 10), true);
});

test('wouldEmptyCapabilityGroup: returns false when removing a different member from a 1-member group', () => {
    const group = makeGroup({ members: [{ id: '10' }] });
    assert.equal(wouldEmptyCapabilityGroup(group, '99'), false);
});

test('wouldEmptyCapabilityGroup: returns false when capability group has empty members array', () => {
    const group = makeGroup({ members: [] });
    assert.equal(wouldEmptyCapabilityGroup(group, '10'), false);
});
