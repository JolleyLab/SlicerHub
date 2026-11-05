import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

let calls = [];
let existing = [];
mock.module('../../../backend/src/payload/index.js', {
    namedExports: {
        getPayloadClient: () => ({
            find: async (args) => { calls.push({ op: 'find', ...args }); return { docs: existing }; },
            create: async (args) => { calls.push({ op: 'create', ...args }); return { id: 1, ...args.data }; },
            update: async (args) => { calls.push({ op: 'update', ...args }); return {}; },
            delete: async (args) => { calls.push({ op: 'delete', ...args }); return {}; }
        })
    }
});
mock.module('../../../backend/src/services/groupStore.js', {
    namedExports: { getGroupsForUser: async () => [] }
});

const { setGroupAccessForCase, removeGroupFromAllCases } = await import('../../../backend/src/services/caseGroupAccess.js');

test.beforeEach(() => {
    calls = [];
    existing = [];
});

// Payload rejects a string id for the integer `case` relationship ("The following field is invalid: Case"),
// and route params are always strings.
test('linking a group stores the case id as a number even when given the route-param string', async () => {
    await setGroupAccessForCase('7', 'g1', 'collaborator');
    const create = calls.find((c) => c.op === 'create');
    assert.deepEqual(create.data, { case: 7, group_id: 'g1', role: 'collaborator' });
});

test('re-linking an already linked group updates its role instead of creating a duplicate', async () => {
    existing = [{ id: 42 }];
    await setGroupAccessForCase('7', 'g1', 'admin');
    assert.equal(calls.some((c) => c.op === 'create'), false);
    assert.deepEqual(calls.find((c) => c.op === 'update').data, { role: 'admin' });
});

test('removing a deleted group unlinks it everywhere and deletes its requests', async () => {
    await removeGroupFromAllCases('g1');
    const deletes = calls.filter((c) => c.op === 'delete');
    assert.deepEqual(deletes.map((c) => c.collection), ['case-group-access', 'case-invites']);
    assert.deepEqual(deletes[0].where, { group_id: { equals: 'g1' } });
    assert.deepEqual(deletes[1].where, { and: [{ kind: { equals: 'group' } }, { group_id: { equals: 'g1' } }] });
});
