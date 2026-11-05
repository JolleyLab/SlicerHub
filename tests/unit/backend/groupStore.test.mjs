import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// CRUD functions call getPayloadClient() internally (no dependency injection), so a fake
// Payload client is substituted before import. Reassigning `payloadClient` between tests
// changes what the mock returns without needing to re-import the module.
let payloadClient = null;
mock.module('../../../backend/src/payload/index.js', {
    namedExports: { getPayloadClient: () => payloadClient }
});

const {
    mapGroup,
    mapMember,
    wouldEmptyCapabilityGroup,
    listGroups,
    getGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    addGroupMember,
    removeGroupMember,
    getGroupMemberById,
    updateGroupMember,
    getGroupsForUser
} = await import('../../../backend/src/services/groupStore.js');

test.beforeEach(() => {
    payloadClient = null;
});

/** A fake Payload client backed by in-memory arrays, keyed by collection name. */
function fakePayload(initial = {}) {
    const data = { groups: [], 'group-members': [], ...initial };
    const calls = [];
    let nextId = 1000;
    for (const rows of Object.values(data)) {
        for (const row of rows) nextId = Math.max(nextId, Number(row.id) + 1);
    }
    return {
        calls,
        async find({ collection, where, limit, sort }) {
            calls.push({ op: 'find', collection, where });
            let docs = [...(data[collection] || [])];
            if (where?.group_id?.equals !== undefined) {
                docs = docs.filter((d) => String(d.group_id) === String(where.group_id.equals));
            }
            if (where?.kc_sub?.equals !== undefined) {
                docs = docs.filter((d) => d.kc_sub === where.kc_sub.equals);
            }
            if (where?.id?.in) {
                const ids = where.id.in.map(String);
                docs = docs.filter((d) => ids.includes(String(d.id)));
            }
            if (where?.and) {
                docs = docs.filter((d) => where.and.every((cond) => {
                    const [key, { equals }] = Object.entries(cond)[0];
                    return String(d[key]) === String(equals);
                }));
            }
            if (sort === 'name') docs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
            return { docs: docs.slice(0, limit || docs.length), totalDocs: docs.length };
        },
        async findByID({ collection, id }) {
            calls.push({ op: 'findByID', collection, id });
            const doc = (data[collection] || []).find((d) => String(d.id) === String(id));
            if (!doc) throw new Error('not found');
            return doc;
        },
        async create({ collection, data: fields }) {
            calls.push({ op: 'create', collection, data: fields });
            const doc = { id: nextId++, createdAt: '2026-01-01T00:00:00Z', ...fields };
            data[collection] = data[collection] || [];
            data[collection].push(doc);
            return doc;
        },
        async update({ collection, id, data: fields }) {
            calls.push({ op: 'update', collection, id, data: fields });
            const doc = (data[collection] || []).find((d) => String(d.id) === String(id));
            if (!doc) throw new Error('not found');
            Object.assign(doc, fields);
            return doc;
        },
        async delete({ collection, id }) {
            calls.push({ op: 'delete', collection, id });
            data[collection] = (data[collection] || []).filter((d) => String(d.id) !== String(id));
        },
        _rows: data
    };
}

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

test('mapMember includes the group id as a string', () => {
    assert.equal(mapMember({ id: 1, group_id: 7, kc_sub: 'x' }).groupId, '7');
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

// ---------------------------------------------------------------------------
// listGroups / getGroup
// ---------------------------------------------------------------------------

test('listGroups returns [] when Payload is not configured', async () => {
    assert.deepEqual(await listGroups(), []);
});

test('listGroups maps every doc through mapGroup, sorted by name', async () => {
    payloadClient = fakePayload({
        groups: [{ id: 1, name: 'Reviewers', can_approve_registrations: true }]
    });
    const groups = await listGroups();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, '1');
    assert.equal(groups[0].canApproveRegistrations, true);
});

test('getGroup returns null when Payload is not configured', async () => {
    assert.equal(await getGroup('1'), null);
});

test('getGroup returns null for an id that does not exist', async () => {
    payloadClient = fakePayload();
    assert.equal(await getGroup('999'), null);
});

test('getGroup attaches its members to the mapped group', async () => {
    payloadClient = fakePayload({
        groups: [{ id: 1, name: 'Reviewers' }],
        'group-members': [
            { id: 10, group_id: '1', kc_sub: 'sub-a' },
            { id: 11, group_id: '2', kc_sub: 'sub-b' } // different group, must be excluded
        ]
    });
    const group = await getGroup('1');
    assert.equal(group.members.length, 1);
    assert.equal(group.members[0].kcSub, 'sub-a');
});

// ---------------------------------------------------------------------------
// createGroup / updateGroup / deleteGroup
// ---------------------------------------------------------------------------

test('createGroup trims name/description and defaults canApproveRegistrations to false', async () => {
    payloadClient = fakePayload();
    const group = await createGroup({ name: '  Reviewers  ', description: '  ' });
    assert.equal(group.name, 'Reviewers');
    assert.equal(group.description, '');
    assert.equal(group.canApproveRegistrations, false);
});

test('updateGroup only writes fields that were actually passed', async () => {
    payloadClient = fakePayload({ groups: [{ id: 1, name: 'Old', description: 'd', can_approve_registrations: false }] });
    await updateGroup('1', { name: 'New' });
    const [{ data }] = payloadClient.calls.filter((c) => c.op === 'update');
    assert.deepEqual(data, { name: 'New' });
});

test('updateGroup coerces canApproveRegistrations to a boolean when passed', async () => {
    payloadClient = fakePayload({ groups: [{ id: 1, name: 'G' }] });
    const group = await updateGroup('1', { canApproveRegistrations: 1 });
    assert.equal(group.canApproveRegistrations, true);
});

test('deleteGroup removes every member before removing the group itself', async () => {
    payloadClient = fakePayload({
        groups: [{ id: 1, name: 'Reviewers' }],
        'group-members': [{ id: 10, group_id: '1', kc_sub: 'a' }, { id: 11, group_id: '1', kc_sub: 'b' }]
    });
    await deleteGroup('1');
    const deletes = payloadClient.calls.filter((c) => c.op === 'delete');
    assert.deepEqual(deletes.map((d) => d.collection).sort(), ['group-members', 'group-members', 'groups'].sort());
    assert.equal(payloadClient._rows.groups.length, 0);
    assert.equal(payloadClient._rows['group-members'].length, 0);
});

test('deleteGroup on a group with no members still deletes the group', async () => {
    payloadClient = fakePayload({ groups: [{ id: 1, name: 'Empty' }] });
    await deleteGroup('1');
    assert.equal(payloadClient._rows.groups.length, 0);
});

// ---------------------------------------------------------------------------
// addGroupMember / removeGroupMember / getGroupMemberById / updateGroupMember
// ---------------------------------------------------------------------------

test('addGroupMember adds a new member with the requested capability flag', async () => {
    payloadClient = fakePayload();
    const member = await addGroupMember('1', 'sub-a', { canManageGroup: true });
    assert.equal(member.kcSub, 'sub-a');
    assert.equal(member.canManageGroup, true);
});

test('addGroupMember rejects adding someone already in the group, without creating a duplicate', async () => {
    payloadClient = fakePayload({ 'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a' }] });
    await assert.rejects(
        addGroupMember('1', 'sub-a'),
        (err) => err.code === 'ALREADY_MEMBER'
    );
    assert.equal(payloadClient._rows['group-members'].length, 1);
});

test('addGroupMember treats membership as scoped to the group: the same user can join a different group', async () => {
    payloadClient = fakePayload({ 'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a' }] });
    const member = await addGroupMember('2', 'sub-a');
    assert.equal(member.kcSub, 'sub-a');
    assert.equal(payloadClient._rows['group-members'].length, 2);
});

test('removeGroupMember deletes the membership row by id', async () => {
    payloadClient = fakePayload({ 'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a' }] });
    await removeGroupMember('10');
    assert.equal(payloadClient._rows['group-members'].length, 0);
});

test('getGroupMemberById returns null when Payload is not configured or the member does not exist', async () => {
    assert.equal(await getGroupMemberById('10'), null);
    payloadClient = fakePayload();
    assert.equal(await getGroupMemberById('999'), null);
});

test('getGroupMemberById maps a found member', async () => {
    payloadClient = fakePayload({ 'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a', can_manage_group: true }] });
    const member = await getGroupMemberById('10');
    assert.equal(member.kcSub, 'sub-a');
    assert.equal(member.canManageGroup, true);
});

test('updateGroupMember only writes canManageGroup when it was passed', async () => {
    payloadClient = fakePayload({ 'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a', can_manage_group: false }] });
    await updateGroupMember('10', {});
    const [{ data }] = payloadClient.calls.filter((c) => c.op === 'update');
    assert.deepEqual(data, {});
    const member = await updateGroupMember('10', { canManageGroup: true });
    assert.equal(member.canManageGroup, true);
});

// ---------------------------------------------------------------------------
// getGroupsForUser
// ---------------------------------------------------------------------------

test('getGroupsForUser returns [] with no Payload client or no kcSub', async () => {
    assert.deepEqual(await getGroupsForUser('sub-a'), []);
    payloadClient = fakePayload();
    assert.deepEqual(await getGroupsForUser(''), []);
});

test('getGroupsForUser returns [] for a user with no memberships', async () => {
    payloadClient = fakePayload();
    assert.deepEqual(await getGroupsForUser('sub-a'), []);
});

test('getGroupsForUser joins membership rows to their group and reports per-membership capability', async () => {
    payloadClient = fakePayload({
        groups: [{ id: 1, name: 'Reviewers', can_approve_registrations: true }],
        'group-members': [{ id: 10, group_id: '1', kc_sub: 'sub-a', can_manage_group: true }]
    });
    const [entry] = await getGroupsForUser('sub-a');
    assert.equal(entry.membershipId, '10');
    assert.equal(entry.canManageGroup, true);
    assert.equal(entry.group.id, '1');
    assert.equal(entry.group.canApproveRegistrations, true);
});

test('getGroupsForUser drops memberships whose group no longer exists', async () => {
    payloadClient = fakePayload({
        groups: [],
        'group-members': [{ id: 10, group_id: 'deleted-group', kc_sub: 'sub-a' }]
    });
    assert.deepEqual(await getGroupsForUser('sub-a'), []);
});
