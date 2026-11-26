import test from 'node:test';
import assert from 'node:assert/strict';
import { mocks } from './helpers/caseRouteMocks.mjs';
import { makeApp, dispatch } from './helpers/routeHarness.mjs';
import { ADMIN, MEMBER, READER, STRANGER, workflow, seedWorkflows } from './helpers/workflowFixtures.mjs';

const { default: caseWorkflowRoutes } = await import('../../../backend/src/routes/caseWorkflows.js');
const { default: caseWorkflowRequestRoutes } = await import('../../../backend/src/routes/caseWorkflowRequests.js');
const { REQUEST_COOLDOWN_MS, MAX_PENDING_PER_MEMBER } = await import('../../../backend/src/services/workflowRequests.js');
/** When a decline at `msAgo` happened. */
const ago = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const app = makeApp();
caseWorkflowRoutes(app);
caseWorkflowRequestRoutes(app);
const call = (method, path, opts) => dispatch(app, method, path, opts);

const OTHER = { id: 5, role: 'user', keycloakSub: 'kc-other' }; // a second collaborator on case 1

const request = (user, workflowId = 11) => call('POST', '/api/cases/1/workflows/requests', { user, body: { workflowId } });
const rows = () => mocks.payload.rows['case-workflows'] || [];
/** Who is asking for a workflow on case 1, oldest first. */
const requesters = (workflowId = 11) => (mocks.payload.rows['case-workflow-requesters'] || [])
    .filter((r) => String(r.case) === '1' && r.workflow === String(workflowId)).map((r) => r.user_sub);
const caseView = async (user) => (await call('GET', '/api/cases/1/workflows', { user })).body;

test.beforeEach(() => {
    seedWorkflows();
    mocks.caseRoles['kc-other:1'] = 'collaborator';
    mocks.names['kc-other'] = 'Oli Other';
});

// ── requesting ─────────────────────────────────────────────────────────────

test('a collaborator can request a public workflow; read_only members and strangers cannot', async () => {
    assert.equal((await request(MEMBER)).status, 201);
    const [row] = rows();
    assert.equal(row.status, 'pending');
    assert.deepEqual(requesters(), ['kc-member']);
    assert.equal(row.name, 'WF 11');

    assert.equal((await request(READER)).status, 403);
    assert.equal((await request(STRANGER)).status, 404); // the case doesn't exist, as far as they can tell
    assert.equal((await caseView(READER)).canRequest, false);
    assert.equal((await caseView(MEMBER)).canRequest, true);
});

test('only public workflows can be requested', async () => {
    assert.equal((await request(MEMBER, 10)).status, 400); // the member's own, private
    assert.equal((await request(MEMBER, 12)).status, 404); // someone else's private one
    assert.equal(rows().length, 0);
});

test('a second request joins the first: one row, both requesters', async () => {
    await request(MEMBER);
    assert.equal((await request(OTHER)).status, 200);
    await request(OTHER); // asking twice changes nothing
    assert.equal(rows().length, 1);
    assert.deepEqual(requesters(), ['kc-member', 'kc-other']);

    const { requests } = await caseView(ADMIN);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].requesterNames, ['Mia Member', 'Oli Other']);
    assert.equal(requests[0].sourcePublic, true);
    assert.equal(requests[0].previousDecline, null);
});

test('pending requests are not launchable; requesters see their own; only admins see all requests', async () => {
    await request(MEMBER);
    const member = await caseView(MEMBER);
    assert.deepEqual(member.approved, []);
    assert.deepEqual(member.myRequests, [{ workflowId: '11', name: 'WF 11' }]);
    assert.equal('requests' in member, false);
    assert.deepEqual((await caseView(OTHER)).myRequests, []);
});

test('an approved workflow cannot be requested', async () => {
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal((await request(MEMBER)).status, 409);
});

// ── cancelling ─────────────────────────────────────────────────────────────

test('a requester can cancel; the last one out removes the request', async () => {
    await request(MEMBER);
    await request(OTHER);
    assert.equal((await call('DELETE', '/api/cases/1/workflows/requests/11', { user: MEMBER })).status, 204);
    assert.deepEqual(requesters(), ['kc-other']);
    assert.equal((await call('DELETE', '/api/cases/1/workflows/requests/11', { user: MEMBER })).status, 404);
    await call('DELETE', '/api/cases/1/workflows/requests/11', { user: OTHER });
    assert.equal(rows().length, 0);
    assert.deepEqual(requesters(), []);
});

// ── deciding ───────────────────────────────────────────────────────────────

test('approving a request copies the workflow, clears the requesters and tells them', async () => {
    await request(MEMBER);
    await request(OTHER);
    const res = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal(res.status, 200);
    const [row] = rows();
    assert.equal(row.status, 'approved');
    assert.deepEqual(requesters(), []);
    assert.deepEqual(mocks.notifications.map((n) => [n.userId, n.type]), [
        ['kc-member', 'workflow_request_approved'],
        ['kc-other', 'workflow_request_approved'],
    ]);
    assert.equal(mocks.notifications[0].title, '"WF 11" is now available in "Case"');
    assert.equal(mocks.notifications[0].caseId, '1');
    assert.deepEqual((await caseView(MEMBER)).approved.map((a) => a.name), ['WF 11']);
});

test('declining tells requesters with the reason; only admins decline, and only pending rows', async () => {
    await request(MEMBER);
    const [row] = rows();
    const decline = (user, body) => call('POST', `/api/cases/1/workflows/${row.id}/decline`, { user, body });
    assert.equal((await decline(MEMBER, {})).status, 403);
    assert.equal((await decline(ADMIN, { reason: 'x'.repeat(501) })).status, 400);

    assert.equal((await decline(ADMIN, { reason: ' Use Cardiac instead ' })).status, 204);
    assert.equal(row.status, 'declined');
    assert.deepEqual(requesters(), []);
    assert.equal(row.decline_reason, 'Use Cardiac instead');
    assert.deepEqual(mocks.notifications.map((n) => [n.userId, n.type, n.body]), [
        ['kc-member', 'workflow_request_declined', 'Use Cardiac instead'],
    ]);
    assert.equal((await decline(ADMIN, {})).status, 409);
});

test('requesting again after a decline reopens the row and shows the admin the earlier decline', async () => {
    await request(MEMBER);
    const [row] = rows();
    await call('POST', `/api/cases/1/workflows/${row.id}/decline`, { user: ADMIN, body: { reason: 'Not yet' } });
    row.decided_at = ago(REQUEST_COOLDOWN_MS + 60_000); // past the cooldown
    assert.equal((await request(OTHER)).status, 201);
    assert.equal(rows().length, 1);
    assert.deepEqual(requesters(), ['kc-other']);

    const [shown] = (await caseView(ADMIN)).requests;
    assert.deepEqual(shown.requesterNames, ['Oli Other']);
    assert.equal(shown.previousDecline.reason, 'Not yet');

    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal(row.decline_reason, null);
});

// ── limits ─────────────────────────────────────────────────────────────────
// Each uses its own requester: the rate limit counts per person across this whole file.

/** A collaborator on case 1 with a fresh rate-limit count. */
const collaborator = (sub) => {
    mocks.caseRoles[`${sub}:1`] = 'collaborator';
    return { id: 90, role: 'user', keycloakSub: sub };
};
const addPublicWorkflows = (ids) => ids.forEach((id) => mocks.payload.rows.workflows.push(workflow(id, 'kc-stranger', 'public')));

test('a declined workflow can be asked for again a day later, by anyone in the case', async () => {
    const asker = collaborator('kc-cooldown');
    await request(asker);
    const [row] = rows();
    await call('POST', `/api/cases/1/workflows/${row.id}/decline`, { user: ADMIN, body: {} });

    const refused = await request(collaborator('kc-cooldown-2'));
    assert.equal(refused.status, 409);
    assert.equal(refused.error.messageKey, 'workflow.declined_recently');
    assert.equal(row.status, 'declined');

    row.decided_at = ago(REQUEST_COOLDOWN_MS - 60_000);
    assert.equal((await request(asker)).status, 409);
    row.decided_at = ago(REQUEST_COOLDOWN_MS + 60_000);
    assert.equal((await request(asker)).status, 201);

    // An admin can still add it directly.
    await call('POST', `/api/cases/1/workflows/${row.id}/decline`, { user: ADMIN, body: {} });
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } })).status, 200);
});

test('a declined workflow that has been changed since can be asked for again at once', async () => {
    const asker = collaborator('kc-changed');
    await request(asker);
    const [row] = rows();
    await call('POST', `/api/cases/1/workflows/${row.id}/decline`, { user: ADMIN, body: { reason: 'Needs a description' } });
    const source = mocks.payload.rows.workflows.find((w) => w.id === 11);

    source.icon_key = 'workflows/11/new.png'; // not something a case copies
    assert.equal((await request(asker)).status, 409);
    source.description = 'Radiotherapy and cardiac tools';
    assert.equal((await request(asker)).status, 201);
    assert.equal(row.description, 'Radiotherapy and cardiac tools', 'the request carries the new copy');
});

test('a member can have only so many requests waiting on a case; cancelling one makes room', async () => {
    const asker = collaborator('kc-cap');
    const ids = Array.from({ length: MAX_PENDING_PER_MEMBER + 1 }, (_, i) => 100 + i);
    addPublicWorkflows(ids);
    for (const id of ids.slice(0, -1)) assert.equal((await request(asker, id)).status, 201);

    const refused = await request(asker, ids.at(-1));
    assert.equal(refused.status, 409);
    assert.equal(refused.error.messageKey, 'workflow.too_many_pending');
    assert.equal((await request(asker, ids[0])).status, 200, 'asking again for one already asked for is fine');

    await call('DELETE', `/api/cases/1/workflows/requests/${ids[0]}`, { user: asker });
    assert.equal((await request(asker, ids.at(-1))).status, 201);
});

test('requesting and cancelling are rate limited per person', async () => {
    const asker = collaborator('kc-busy');
    let last;
    for (let i = 0; i < 31; i += 1) {
        last = await call('DELETE', '/api/cases/1/workflows/requests/11', { user: asker });
    }
    assert.equal(last.status, 429);
    assert.equal(last.error.messageKey, 'workflow.too_many_requests');
    assert.equal((await request(collaborator('kc-calm'))).status, 201, 'someone else is not held back');
});

test('a pending request cannot be removed, only declined', async () => {
    await request(MEMBER);
    assert.equal((await call('DELETE', `/api/cases/1/workflows/${rows()[0].id}`, { user: ADMIN })).status, 409);
});

test('a request whose source is no longer public cannot be approved', async () => {
    await request(MEMBER);
    mocks.payload.rows.workflows.find((w) => w.id === 11).visibility = 'private';
    const [shown] = (await caseView(ADMIN)).requests;
    assert.equal(shown.sourcePublic, false);
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } })).status, 404);
});

test('requesters who leave the case, or become read_only, are left out when read, without writing', async () => {
    await request(MEMBER);
    await request(OTHER);
    delete mocks.caseRoles['kc-other:1'];
    assert.deepEqual((await caseView(ADMIN)).requests[0].requesterNames, ['Mia Member']);
    assert.deepEqual(requesters(), ['kc-member', 'kc-other']); // a GET changes nothing

    mocks.caseRoles['kc-member:1'] = 'read_only';
    assert.deepEqual((await caseView(ADMIN)).requests, []);
    assert.equal(rows().length, 1); // hidden, and reused if someone asks again

    mocks.caseRoles['kc-member:1'] = 'collaborator';
    assert.equal((await request(MEMBER)).status, 200);
    assert.deepEqual((await caseView(ADMIN)).requests[0].requesterNames, ['Mia Member']);
});

test('only requesters still in the case are told the outcome, and nobody is kept as a requester', async () => {
    await request(MEMBER);
    await request(OTHER);
    delete mocks.caseRoles['kc-other:1']; // left the case: mustn't learn its title from a notification
    await call('POST', `/api/cases/1/workflows/${rows()[0].id}/decline`, { user: ADMIN, body: {} });
    assert.deepEqual(mocks.notifications.map((n) => n.userId), ['kc-member']);
    assert.deepEqual(requesters(), []);
});

// ── two people at once ─────────────────────────────────────────────────────

/** The next create in `collection` behaves as if someone else's identical one got there first. */
function loseTheRace(collection) {
    const create = mocks.payload.create;
    mocks.payload.create = async (args) => {
        mocks.payload.create = create;
        if (args.collection !== collection) return create(args);
        await create(args); // theirs
        throw new Error('duplicate key value violates unique constraint');
    };
}

test('two first requests at once make one request: the second joins the row the first made', async () => {
    loseTheRace('case-workflows');
    assert.equal((await request(OTHER)).status, 201);
    assert.equal(rows().length, 1);
    assert.deepEqual(requesters(), ['kc-other']);
});

test('asking at the same moment twice keeps one requester row', async () => {
    loseTheRace('case-workflow-requesters');
    assert.equal((await request(MEMBER)).status, 201);
    assert.deepEqual(requesters(), ['kc-member']);
});

// ── finding more, and the admin's list across cases ───────────────────────

test('"Request or Add" offers unapproved public workflows, marking requests; admins also see their own', async () => {
    mocks.payload.rows.workflows.push(workflow(13, 'kc-stranger', 'public', undefined, { name: 'Valve tools', file_types: ['nrrd'] }));
    await request(OTHER, 13);
    const available = (user, query) => call('GET', '/api/cases/1/workflows/available', { user, query });

    let res = await available(MEMBER);
    assert.deepEqual(res.body.workflows.map((w) => [w.id, w.requested, w.requestedByMe]), [[13, true, false], [11, false, false]]);
    assert.deepEqual((await available(OTHER)).body.workflows.find((w) => w.id === 13).requestedByMe, true);
    assert.deepEqual((await available(ADMIN)).body.workflows.map((w) => w.id), [13, 11, 12]);
    assert.equal((await available(READER)).status, 403);

    // Searched on the server: every word, in the name, description, extensions or file types.
    res = await available(MEMBER, { q: 'valve' });
    assert.deepEqual(res.body.workflows.map((w) => w.id), [13]);
    res = await available(MEMBER, { q: 'NRRD tools' });
    assert.deepEqual(res.body.workflows.map((w) => w.id), [13]);
    res = await available(MEMBER, { q: 'slicerrt' });
    assert.deepEqual(res.body.workflows.map((w) => w.id), [11]);

    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.deepEqual((await available(MEMBER)).body.workflows.map((w) => w.id), [13]);
});

test('the pending list covers the cases the user administers, with their titles', async () => {
    mocks.payload.rows.cases.push({ id: 2, title: 'Not mine', owner_id: 'kc-stranger' });
    mocks.caseRoles['kc-member:2'] = 'collaborator';
    await request(MEMBER);
    await call('POST', '/api/cases/2/workflows/requests', { user: MEMBER, body: { workflowId: 11 } });

    const mine = await call('GET', '/api/workflow-requests/pending', { user: ADMIN });
    assert.deepEqual(mine.body.requests.map((r) => [r.caseId, r.caseTitle, r.name]), [['1', 'Case', 'WF 11']]);
    assert.equal((await call('GET', '/api/workflow-requests/pending', { user: STRANGER })).body.requests.length, 1);
    assert.deepEqual((await call('GET', '/api/workflow-requests/pending', { user: MEMBER })).body.requests, []);

    mocks.caseRoles['kc-member:2'] = 'admin';
    const viaRole = await call('GET', '/api/workflow-requests/pending', { user: MEMBER });
    assert.deepEqual(viaRole.body.requests.map((r) => r.caseId), ['2']);
});

test("a site admin's pending list covers every case; an org admin's only the cases they're admin of", async () => {
    mocks.payload.rows.cases.push({ id: 2, title: 'Not mine', owner_id: 'kc-stranger' });
    mocks.caseRoles['kc-member:2'] = 'collaborator';
    await request(MEMBER);
    await call('POST', '/api/cases/2/workflows/requests', { user: MEMBER, body: { workflowId: 11 } });

    const pending = async (user) => (await call('GET', '/api/workflow-requests/pending', { user })).body.requests.map((r) => r.caseId).sort();
    assert.deepEqual(await pending({ id: 7, role: 'admin', keycloakSub: 'kc-site' }), ['1', '2']);
    assert.deepEqual(await pending({ id: 8, role: 'org-admin', keycloakSub: 'kc-org' }), []);
});

test('the pending list and the bell include every request, past one page of rows', async () => {
    const total = 205; // more than one 200-row page of requests and of requesters
    for (let i = 0; i < total; i += 1) {
        const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
        mocks.payload.rows['case-workflows'] = [...rows(), { id: 1000 + i, case: 1, workflow: String(100 + i), name: `Asked ${i}`, status: 'pending', requested_at: at }];
        (mocks.payload.rows['case-workflow-requesters'] ||= []).push({ id: 5000 + i, case: 1, workflow: String(100 + i), user_sub: 'kc-member', createdAt: at });
    }
    const pending = (await call('GET', '/api/workflow-requests/pending', { user: ADMIN })).body.requests;
    assert.equal(pending.length, total);
    assert.equal(pending[0].name, `Asked ${total - 1}`); // newest first, newest included
    assert.equal((await call('GET', '/api/workflow-requests/pending-count', { user: ADMIN })).body.count, total);
});

test("the bell's count: pending requests on cases the requester administers, one however many asked, gone once nobody is asking", async () => {
    const count = async (user = ADMIN) => (await call('GET', '/api/workflow-requests/pending-count', { user })).body.count;
    mocks.payload.rows.workflows.push(workflow(13, 'kc-stranger', 'public'));
    assert.equal(await count(), 0);
    await request(MEMBER);
    await request(OTHER);
    await request(MEMBER, 13);
    assert.equal(await count(), 2);
    assert.equal(await count(MEMBER), 0);
    // With when the newest arrived, so the bell can light only for ones since it was last opened.
    const { latestAt } = (await call('GET', '/api/workflow-requests/pending-count', { user: ADMIN })).body;
    assert.ok(Date.parse(latestAt));

    await call('DELETE', '/api/cases/1/workflows/requests/13', { user: MEMBER });
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal(await count(), 0);
});
