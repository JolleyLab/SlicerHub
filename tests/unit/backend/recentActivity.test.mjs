import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Importing the service pulls in the app config; keep any database it opens in a scratch file.
const scratchDb = path.join(os.tmpdir(), `recent-activity-test-${process.pid}.db`);
process.env.DB_PATH = scratchDb;
process.env.DB_SEED_PATH = `${scratchDb}.no-seed`;
test.after(() => fs.rmSync(scratchDb, { force: true }));

const { listRecentActivity, ACTIVITY_TYPES } = await import('../../../backend/src/services/recentActivity.js');
const { mapInvite } = await import('../../../backend/src/services/caseInviteStore.js');

const ME = 'user-me';
const invite = (over) => ({
    id: '1', kind: 'existing', status: 'pending_approval', caseId: 'c1', caseTitle: 'Cardiac CT',
    inviteeEmail: 'a@x.org', proposedRole: 'collaborator',
    inviterDirectusUserId: 'user-other', inviterName: 'M. Ortiz',
    resolvedByDirectusUserId: null, resolvedByName: null,
    createdAt: '2026-09-25T10:00:00.000Z', resolvedAt: null, ...over
});
const run = (invites, extra = {}) => listRecentActivity({
    userId: ME,
    listCaseIds: async () => ['c1'],
    listInvites: async () => invites,
    ...extra
});

test('a sent invite is one event, with who sent it', async () => {
    const [event] = await run([invite({})]);
    assert.equal(event.type, ACTIVITY_TYPES.INVITE_SENT);
    assert.equal(event.actorName, 'M. Ortiz');
    assert.equal(event.actorIsMe, false);
    assert.equal(event.caseTitle, 'Cardiac CT');
    assert.equal(event.at, '2026-09-25T10:00:00.000Z');
});

test('an approved invite is a sent event and an approved event, the second by the approver', async () => {
    const events = await run([invite({
        status: 'approved', resolvedAt: '2026-09-25T11:00:00.000Z',
        resolvedByDirectusUserId: ME, resolvedByName: 'Rachel'
    })]);
    assert.deepEqual(events.map((e) => e.type), [ACTIVITY_TYPES.INVITE_APPROVED, ACTIVITY_TYPES.INVITE_SENT], 'newest first');
    assert.equal(events[0].actorIsMe, true);
});

test('an admin who added someone directly gets one event, not a sent and an approved', async () => {
    const events = await run([invite({
        status: 'approved', inviterDirectusUserId: 'admin-1', inviterName: 'Ada',
        resolvedByDirectusUserId: 'admin-1', resolvedByName: 'Ada', resolvedAt: '2026-09-25T10:00:00.000Z'
    })]);
    assert.deepEqual(events.map((e) => e.type), [ACTIVITY_TYPES.INVITE_SENT]);
});

test('rejected and still-pending invites add only their sent event', async () => {
    const events = await run([
        invite({ id: '1', status: 'rejected', resolvedAt: '2026-09-25T11:00:00.000Z' }),
        invite({ id: '2', createdAt: '2026-09-24T10:00:00.000Z' })
    ]);
    assert.deepEqual(events.map((e) => e.type), ['invite_sent', 'invite_sent']);
});

test('the user is recognised as the sender of their own invites', async () => {
    const [event] = await run([invite({ inviterDirectusUserId: ME })]);
    assert.equal(event.actorIsMe, true);
});

test('events are newest first across invites and are capped', async () => {
    const invites = Array.from({ length: 30 }, (_, i) => invite({ id: String(i), createdAt: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));
    const events = await run(invites, { limit: 5 });
    assert.equal(events.length, 5);
    assert.equal(events[0].id, 'invite_sent:29');
});

test('only cases where the user is admin or collaborator are asked for', async () => {
    let asked;
    await run([], {
        listCaseIds: async (userId, roles) => { asked = { userId, roles }; return ['c1']; }
    });
    assert.deepEqual(asked, { userId: ME, roles: ['admin', 'collaborator'] });
});

test('a user with no cases has no activity, and the invite lookup gets no case ids', async () => {
    let askedFor = null;
    const events = await listRecentActivity({
        userId: ME,
        listCaseIds: async () => [],
        listInvites: async (ids) => { askedFor = ids; return []; }
    });
    assert.deepEqual(events, []);
    assert.deepEqual(askedFor, []);
});

test('an invite carries the names of who sent and who resolved it when Directus expands them', () => {
    const mapped = mapInvite({
        id: 'i', kind: 'existing', status: 'approved', case: { id: 'c1', title: 'T' }, invitee_email: 'a@x.org', proposed_role: 'collaborator',
        inviter: { id: 'u1', first_name: 'Mara', last_name: 'Ortiz', email: 'm@x.org' },
        resolved_by: { id: 'u2', first_name: null, last_name: null, email: 'admin@x.org' }
    });
    assert.deepEqual(
        [mapped.inviterDirectusUserId, mapped.inviterName, mapped.resolvedByDirectusUserId, mapped.resolvedByName],
        ['u1', 'Mara Ortiz', 'u2', 'admin@x.org']
    );
    const idOnly = mapInvite({ id: 'i', kind: 'existing', status: 'pending_approval', case: 'c1', invitee_email: 'a@x.org', proposed_role: 'collaborator', inviter: 'u1' });
    assert.equal(idOnly.inviterName, null);
    assert.equal(idOnly.inviterDirectusUserId, 'u1');
});
