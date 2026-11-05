import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// recentActivity.js calls getUserCaseRoleMap/getKeycloakUser/kcDisplayName from keycloakAdmin.js,
// which talk to a real Keycloak server. Replace them with controllable fakes before import.
let roleMap = {};
let users = {}; // kcSub -> { firstName, lastName, username, email } | undefined
let getKeycloakUserCalls = [];

mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        getUserCaseRoleMap: async () => roleMap,
        getKeycloakUser: async (sub) => {
            getKeycloakUserCalls.push(sub);
            return users[sub] || null;
        },
        kcDisplayName: (user) => {
            if (!user) return '';
            const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
            return full || user.username || user.email || '';
        }
    }
});

let groupRoleMap = {};
let groups = {}; // groupId -> { id, name }
mock.module('../../../backend/src/services/caseGroupAccess.js', {
    namedExports: { getCaseRoleMapFromGroups: async () => groupRoleMap }
});
mock.module('../../../backend/src/services/groupStore.js', {
    namedExports: { getGroup: async (id) => groups[id] || null }
});

const { listRecentActivityKC, ACTIVITY_TYPES } = await import('../../../backend/src/services/recentActivity.js');

const ME = 'kc-me';

test.beforeEach(() => {
    roleMap = {};
    users = {};
    getKeycloakUserCalls = [];
    groupRoleMap = {};
    groups = {};
});

/** A fake Payload client. Each key is a collection name; docs() returns {docs}. */
function fakePayload(byCollection) {
    const calls = [];
    return {
        calls,
        find: async ({ collection, where, sort, limit, depth }) => {
            calls.push({ collection, where, sort, limit, depth });
            const docs = byCollection[collection];
            if (!docs) throw new Error(`unexpected collection ${collection}`);
            return { docs };
        }
    };
}

test('no kcSub or no payload client short-circuits to an empty list', async () => {
    assert.deepEqual(await listRecentActivityKC({ kcSub: '', payload: fakePayload({ cases: [] }) }), []);
    assert.deepEqual(await listRecentActivityKC({ kcSub: ME, payload: null }), []);
});

test('a user with no KC case roles and no owned cases gets no activity, and only "cases" is queried', async () => {
    const payload = fakePayload({ cases: [] });
    const events = await listRecentActivityKC({ kcSub: ME, payload });
    assert.deepEqual(events, []);
    assert.deepEqual(payload.calls.map((c) => c.collection), ['cases']);
});

test('only admin and collaborator KC roles contribute case ids; read_only does not', async () => {
    roleMap = { 'case-1': 'admin', 'case-2': 'collaborator', 'case-3': 'read_only' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [],
        'case-comments': [],
        attachments: []
    });
    await listRecentActivityKC({ kcSub: ME, payload });
    const inviteCall = payload.calls.find((c) => c.collection === 'case-invites');
    assert.deepEqual([...inviteCall.where.case.in].sort(), ['case-1', 'case-2']);
});

test('case ids from KC roles and from Payload ownership are merged and de-duplicated', async () => {
    roleMap = { 'case-1': 'admin' };
    const payload = fakePayload({
        cases: [{ id: 'case-1' }, { id: 'case-2' }],
        'case-invites': [],
        'case-comments': [],
        attachments: []
    });
    await listRecentActivityKC({ kcSub: ME, payload });
    const inviteCall = payload.calls.find((c) => c.collection === 'case-invites');
    assert.deepEqual([...inviteCall.where.case.in].sort(), ['case-1', 'case-2']);
});

test('cases reached through SlicerHub group access contribute activity, read_only excepted', async () => {
    groupRoleMap = { 'case-3': 'collaborator', 'case-4': 'read_only' };
    const payload = fakePayload({ cases: [], 'case-invites': [], 'case-comments': [], attachments: [] });
    await listRecentActivityKC({ kcSub: ME, payload });
    const inviteCall = payload.calls.find((c) => c.collection === 'case-invites');
    assert.deepEqual([...inviteCall.where.case.in], ['case-3']);
});

test('a group invite names the group as the invitee', async () => {
    roleMap = { c1: 'admin' };
    groups.g1 = { id: 'g1', name: 'Radiology Team' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [{
            id: 'i1', kind: 'group', group_id: 'g1', case: 'c1', invitee_email: null,
            role: 'collaborator', inviter_id: 'inviter-1', createdAt: '2026-09-25T10:00:00.000Z'
        }],
        'case-comments': [],
        attachments: []
    });
    const [event] = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(event.inviteeName, 'Radiology Team');
});

test('a sent invite is one event; an invite missing createdAt contributes nothing', async () => {
    roleMap = { c1: 'admin' };
    users['inviter-1'] = { firstName: 'Mara', lastName: 'Ortiz' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [
            {
                id: 'i1', case: { id: 'c1', title: 'Cardiac CT' }, invitee_email: 'a@x.org',
                role: 'collaborator', inviter_id: 'inviter-1', createdAt: '2026-09-25T10:00:00.000Z'
            },
            { id: 'i2', case: 'c1', invitee_email: 'b@x.org', role: 'read_only', inviter_id: 'inviter-1' }
        ],
        'case-comments': [],
        attachments: []
    });
    const events = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, ACTIVITY_TYPES.INVITE_SENT);
    assert.equal(events[0].caseId, 'c1');
    assert.equal(events[0].caseTitle, 'Cardiac CT');
    assert.equal(events[0].actorName, 'Mara Ortiz');
    assert.equal(events[0].actorIsMe, false);
    assert.equal(events[0].proposedRole, 'collaborator');
});

test('the inviter is recognised as the current user without a KC lookup', async () => {
    roleMap = { c1: 'admin' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [{ id: 'i1', case: 'c1', invitee_email: 'a@x.org', role: 'admin', inviter_id: ME, createdAt: '2026-09-25T10:00:00.000Z' }],
        'case-comments': [],
        attachments: []
    });
    const [event] = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(event.actorIsMe, true);
});

test('comments skip the viewer\'s own and are truncated to 200 characters', async () => {
    roleMap = { c1: 'admin' };
    users['author-1'] = { username: 'drsmith' };
    const longBody = 'x'.repeat(250);
    const payload = fakePayload({
        cases: [],
        'case-invites': [],
        'case-comments': [
            { id: 'c-mine', case: 'c1', author_id: ME, createdAt: '2026-09-25T09:00:00.000Z', body: 'hi' },
            { id: 'c-theirs', case: { id: 'c1', title: 'CT' }, author_id: 'author-1', createdAt: '2026-09-25T10:00:00.000Z', body: longBody },
            { id: 'c-no-date', case: 'c1', author_id: 'author-1', body: 'no date' }
        ],
        attachments: []
    });
    const events = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, ACTIVITY_TYPES.COMMENT_POSTED);
    assert.equal(events[0].actorName, 'drsmith');
    assert.equal(events[0].commentBody.length, 200);
});

test('attachment uploads map actorIsMe and the file name', async () => {
    roleMap = { c1: 'admin' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [],
        'case-comments': [],
        attachments: [
            { id: 'a1', case: { id: 'c1', title: 'CT' }, uploaded_by: ME, createdAt: '2026-09-25T10:00:00.000Z', original_filename: 'scan.dcm' },
            { id: 'a2', case: 'c1', uploaded_by: 'someone-else', createdAt: '2026-09-25T09:00:00.000Z', original_filename: 'report.pdf' }
        ]
    });
    const events = await listRecentActivityKC({ kcSub: ME, payload });
    assert.deepEqual(events.map((e) => e.fileName), ['scan.dcm', 'report.pdf']);
    assert.deepEqual(events.map((e) => e.actorIsMe), [true, false]);
});

test('a name already resolved from invites is not looked up again for comments or attachments', async () => {
    roleMap = { c1: 'admin' };
    users['person-1'] = { firstName: 'Ada', lastName: 'Lovelace' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [{ id: 'i1', case: 'c1', invitee_email: 'a@x.org', role: 'admin', inviter_id: 'person-1', createdAt: '2026-09-25T08:00:00.000Z' }],
        'case-comments': [{ id: 'c1', case: 'c1', author_id: 'person-1', createdAt: '2026-09-25T09:00:00.000Z', body: 'hi' }],
        attachments: [{ id: 'a1', case: 'c1', uploaded_by: 'person-1', createdAt: '2026-09-25T10:00:00.000Z', original_filename: 'f.txt' }]
    });
    const events = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(getKeycloakUserCalls.filter((s) => s === 'person-1').length, 1);
    assert.ok(events.every((e) => e.actorName === 'Ada Lovelace'));
});

test('events across all three sources are merged newest-first and capped at the limit', async () => {
    roleMap = { c1: 'admin' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [{ id: 'i1', case: 'c1', invitee_email: 'a@x.org', role: 'admin', inviter_id: 'x', createdAt: '2026-09-25T08:00:00.000Z' }],
        'case-comments': [{ id: 'c1', case: 'c1', author_id: 'x', createdAt: '2026-09-25T10:00:00.000Z', body: 'newest' }],
        attachments: [{ id: 'a1', case: 'c1', uploaded_by: 'x', createdAt: '2026-09-25T09:00:00.000Z', original_filename: 'f.txt' }]
    });
    const events = await listRecentActivityKC({ kcSub: ME, payload, limit: 2 });
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.type), [ACTIVITY_TYPES.COMMENT_POSTED, ACTIVITY_TYPES.ATTACHMENT_UPLOADED]);
});

test('an unknown KC user resolves to a null actor name rather than throwing', async () => {
    roleMap = { c1: 'admin' };
    const payload = fakePayload({
        cases: [],
        'case-invites': [{ id: 'i1', case: 'c1', invitee_email: 'a@x.org', role: 'admin', inviter_id: 'ghost', createdAt: '2026-09-25T08:00:00.000Z' }],
        'case-comments': [],
        attachments: []
    });
    const [event] = await listRecentActivityKC({ kcSub: ME, payload });
    assert.equal(event.actorName, null);
});
