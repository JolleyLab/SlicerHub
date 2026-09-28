import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Importing the service pulls in the app config; keep any database it opens in a scratch file.
const scratchDb = path.join(os.tmpdir(), `case-invite-store-test-${process.pid}.db`);
process.env.DB_PATH = scratchDb;
process.env.DB_SEED_PATH = `${scratchDb}.no-seed`;
test.after(() => fs.rmSync(scratchDb, { force: true }));

const { createCaseInviteStore, mapInvite, utcIso, INVITE_STATUS } = await import('../../../backend/src/services/caseInviteStore.js');
const { listInvitesAwaitingApproval } = await import('../../../backend/src/services/pendingApprovals.js');

/** In-memory Directus `case_invite` collection that understands the filters the store uses. */
function fakeDirectus() {
    const rows = [];
    let n = 0;
    const calls = [];
    const matches = (row, query) => Object.entries(query).every(([key, value]) => {
        const m = key.match(/^filter\[(\w+)\]\[(_eq|_in|_lt)\]$/);
        if (!m) return true;
        const [, field, op] = m;
        if (op === '_eq') return String(row[field]) === String(value);
        if (op === '_in') return String(value).split(',').includes(String(row[field]));
        return row[field] != null && row[field] < value;
    });
    const fetchDirectus = async (route, { method = 'GET', query = {}, body } = {}) => {
        calls.push({ route, method, query, body });
        const one = route.match(/^\/items\/case_invite\/(.+)$/);
        if (one) {
            const row = rows.find((r) => r.id === decodeURIComponent(one[1]));
            if (!row) {
                // What the real client throws for a service-token 403: status 502, code in the extensions.
                const err = new Error('You do not have permission to access this.');
                err.statusCode = 502;
                err.directusExtensions = { code: 'FORBIDDEN' };
                throw err;
            }
            if (method === 'PATCH') Object.assign(row, body);
            if (method === 'DELETE') {
                rows.splice(rows.indexOf(row), 1);
                return { data: null };
            }
            return { data: { ...row } };
        }
        if (method === 'POST') {
            n += 1;
            const row = { id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, date_created: `2026-09-2${n}T10:00:00Z`, ...body };
            rows.push(row);
            return { data: { ...row } };
        }
        return { data: rows.filter((r) => matches(r, query)).map((r) => ({ ...r })) };
    };
    return { store: createCaseInviteStore({ fetchDirectus }), rows, calls };
}

const base = {
    kind: 'existing', status: INVITE_STATUS.PENDING_APPROVAL, caseId: 'c1',
    inviteeEmail: 'A@Example.org', inviteeUserId: 'u2', proposedRole: 'collaborator', inviterId: 'u1'
};

test('an invite is stored with its email in lower case and read back in the API shape', async () => {
    const { store, rows } = fakeDirectus();
    const invite = await store.createInvite(base);
    assert.equal(rows[0].invitee_email, 'a@example.org');
    assert.deepEqual(
        { id: typeof invite.id, kind: invite.kind, caseId: invite.caseId, inviteeDirectusUserId: invite.inviteeDirectusUserId, proposedRole: invite.proposedRole, status: invite.status },
        { id: 'string', kind: 'existing', caseId: 'c1', inviteeDirectusUserId: 'u2', proposedRole: 'collaborator', status: 'pending_approval' }
    );
    assert.equal(rows[0].case_title, undefined, 'the title is not stored on the invite');
    assert.ok(invite.createdAt);
});

test('reads never ask Directus for the token hash', async () => {
    const { store, calls } = fakeDirectus();
    await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, tokenHash: 'abc', status: INVITE_STATUS.PENDING_SIGNUP });
    await store.listOpenForCase('c1');
    await store.getInvite('missing');
    for (const call of calls) assert.ok(!String(call.query?.fields || '').includes('token_hash'), call.route);
});

test('an unknown invite id is absent, not an error (Directus answers 403 for it)', async () => {
    const { store } = fakeDirectus();
    assert.equal(await store.getInvite('nope'), null);
    assert.equal(await store.getInvite(''), null);
});

test('open invites of a case are only the ones still waiting, on that case', async () => {
    const { store } = fakeDirectus();
    const waiting = await store.createInvite(base);
    const link = await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, inviteeEmail: 's@x.org', status: INVITE_STATUS.PENDING_SIGNUP });
    const done = await store.createInvite({ ...base, inviteeEmail: 'd@x.org' });
    await store.updateInvite(done.id, { status: INVITE_STATUS.APPROVED });
    await store.createInvite({ ...base, caseId: 'c2', inviteeEmail: 'o@x.org' });
    const open = await store.listOpenForCase('c1');
    assert.deepEqual(open.map((i) => i.id).sort(), [waiting.id, link.id].sort());
});

test('a duplicate check finds an open invite for the same person or email, and ignores resolved ones', async () => {
    const { store } = fakeDirectus();
    const invite = await store.createInvite(base);
    assert.equal((await store.findOpenExistingUserInvite('c1', 'u2')).id, invite.id);
    assert.equal(await store.findOpenExistingUserInvite('c1', 'u3'), null);
    assert.equal((await store.findOpenByEmail('c1', 'A@EXAMPLE.ORG')).id, invite.id);
    await store.updateInvite(invite.id, { status: INVITE_STATUS.REJECTED });
    assert.equal(await store.findOpenExistingUserInvite('c1', 'u2'), null);
    assert.equal(await store.findOpenByEmail('c1', 'a@example.org'), null);
});

test('a signup link is found by its token hash', async () => {
    const { store } = fakeDirectus();
    const invite = await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, tokenHash: 'hash-1', status: INVITE_STATUS.PENDING_SIGNUP });
    assert.equal((await store.findByTokenHash('hash-1')).id, invite.id);
    assert.equal(await store.findByTokenHash('hash-2'), null);
});

test('links that ran out are deleted; live ones are left alone', async () => {
    const { store, rows } = fakeDirectus();
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const old = await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, inviteeEmail: 'old@x.org', tokenHash: 'h1', expiresAt: past, status: INVITE_STATUS.PENDING_SIGNUP });
    const live = await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, inviteeEmail: 'live@x.org', tokenHash: 'h2', expiresAt: future, status: INVITE_STATUS.PENDING_SIGNUP });
    const expired = await store.expireStaleSignupInvites('c1');
    assert.deepEqual(expired, [old.id]);
    assert.equal(rows.find((r) => r.id === old.id), undefined, 'an expired invite is deleted');
    assert.equal(await store.findByTokenHash('h1'), null, 'and its link no longer works');
    assert.equal(rows.find((r) => r.id === live.id).status, 'pending_signup');
});

test('a signup invite past its time reads as expired even before it is swept', () => {
    const invite = mapInvite({
        id: 'i', kind: 'signup', status: 'pending_signup', case: 'c1', invitee_email: 'a@x.org',
        proposed_role: 'collaborator', expires_at: new Date(Date.now() - 1000).toISOString()
    });
    assert.equal(invite.status, 'expired');
});

test('Directus date times without a timezone are read as UTC, whatever the server timezone is', () => {
    assert.equal(utcIso('2026-09-25T19:52:34'), '2026-09-25T19:52:34Z');
    assert.equal(utcIso('2026-09-25T19:52:34.000Z'), '2026-09-25T19:52:34.000Z');
    assert.equal(utcIso('2026-09-25T19:52:34+02:00'), '2026-09-25T19:52:34+02:00');
    assert.equal(utcIso(null), null);
    const minuteAgo = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
    const row = { id: 'i', kind: 'signup', status: 'pending_signup', case: 'c1', invitee_email: 'a@x.org', proposed_role: 'collaborator' };
    assert.equal(mapInvite({ ...row, expires_at: minuteAgo }).status, 'expired');
    const inAMinute = new Date(Date.now() + 60_000).toISOString().slice(0, 19);
    assert.equal(mapInvite({ ...row, expires_at: inAMinute }).status, 'pending_signup');
});

test('an invite with an unrecognised role reads as read only, never more', () => {
    for (const bad of [null, 'superuser', 'readonly', 1]) {
        assert.equal(mapInvite({ id: 'i', kind: 'existing', status: 'pending_approval', case: 'c1', invitee_email: 'a@x.org', proposed_role: bad }).proposedRole, 'read_only');
    }
});

test('the case title comes from the case relation, so it follows a rename', () => {
    const row = { id: 'i', kind: 'existing', status: 'pending_approval', case: { id: 'c1', title: 'Cardiac CT' }, invitee_email: 'a@x.org', proposed_role: 'collaborator' };
    assert.equal(mapInvite(row).caseTitle, 'Cardiac CT');
    assert.equal(mapInvite({ ...row, case: { id: 'c1', title: 'Renamed' } }).caseTitle, 'Renamed');
    assert.equal(mapInvite({ ...row, case: 'c1' }).caseTitle, null);
});

test('relations can arrive as ids or as expanded objects', () => {
    const invite = mapInvite({
        id: 'i', kind: 'existing', status: 'pending_approval', case: { id: 'c9' },
        invitee_user: { id: 'u9' }, inviter: 'u1', invitee_email: 'a@x.org', proposed_role: 'admin'
    });
    assert.deepEqual([invite.caseId, invite.inviteeDirectusUserId, invite.inviterDirectusUserId], ['c9', 'u9', 'u1']);
});

test('invites awaiting approval are only those on cases the user administers', async () => {
    const { store } = fakeDirectus();
    const mine = await store.createInvite(base);
    await store.createInvite({ ...base, caseId: 'c2', inviteeEmail: 'x@x.org' });
    await store.createInvite({ ...base, caseId: 'c3', inviteeEmail: 'y@x.org' });
    const link = await store.createInvite({ ...base, kind: 'signup', inviteeUserId: null, inviteeEmail: 'link@x.org', status: INVITE_STATUS.PENDING_SIGNUP });

    const awaiting = await store.listAwaitingApproval();
    assert.ok(!awaiting.some((i) => i.id === link.id), 'a sent link is not waiting on an approval');

    const checked = [];
    const result = await listInvitesAwaitingApproval({
        listInvites: async () => awaiting,
        isCaseAdmin: async (caseId) => {
            checked.push(caseId);
            if (caseId === 'c3') throw new Error('Directus is down');
            return caseId === 'c1';
        }
    });
    assert.deepEqual(result.map((i) => i.id), [mine.id]);
    assert.deepEqual(checked.sort(), ['c1', 'c2', 'c3'], 'each case is checked once');
});
