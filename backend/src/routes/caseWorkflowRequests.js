/**
 * Requesting public workflows for a case (docs/workflows-design.md › Requests). Approving is
 * POST /api/cases/:id/workflows (routes/caseWorkflows.js), for requests and direct adds alike.
 *
 *   GET    /api/cases/:id/workflows/available?q=&sort=&page=  members above read_only: what "Request or Add" offers
 *   POST   /api/cases/:id/workflows/requests                  members above read_only: { workflowId }
 *   DELETE /api/cases/:id/workflows/requests/:workflowId      a requester cancels their own request
 *   POST   /api/cases/:id/workflows/:rowId/decline            admins: { reason? }
 *   GET    /api/workflow-requests/pending                     requests on cases the user administers
 *   GET    /api/workflow-requests/pending-count               how many, for the bell (no name lookups)
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { loadCaseWithAccess, administeredCasesWhere } from '../utils/caseAccess.js';
import { requireOwnerId, loadOwnedDoc } from '../utils/ownedDocs.js';
import { sanitizeText } from '../utils/validation.js';
import { bellCount } from '../utils/bellCount.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, PUBLIC, VISIBILITY, REQUEST_STATUS, findAll, findWorkflowPage, workflowPageQuery, toWorkflow, isApproved, workflowCopy,
} from '../services/workflows.js';
import {
    REQUEST_MIN_ROLE, MAX_PENDING_PER_MEMBER, isPending, inCooldown, loadCaseWorkflowRow, describeRequests,
    decideRequesters, requestedBy, addRequester, removeRequester, requestersByRequest,
} from '../services/workflowRequests.js';

/** Requesting and cancelling, per person: plenty for real use, not for a script. */
const requestRateLimit = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 30,
    messageKey: 'workflow.too_many_requests',
    getKey: (req) => `workflow-requests:${req.user?.keycloakSub}`,
});

/** Pending requests on every case the requester administers (every case, for a site admin), newest first. */
async function pendingOnAdministeredCases(req) {
    const administered = await administeredCasesWhere(req);
    return administered
        ? findAll(CASE_WORKFLOWS, { and: [administered, { status: { equals: REQUEST_STATUS.PENDING } }] }, '-requested_at')
        : [];
}

const rowFor = async (caseId, workflowId) => (await findAll(CASE_WORKFLOWS, {
    case: { equals: Number(caseId) }, workflow: { equals: String(workflowId) },
}))[0] || null;

/**
 * Create a case's row for a workflow. Two people asking at once both try: the unique index on
 * (case, workflow) refuses the second, which then gets the row the first made.
 */
async function createRow(caseId, workflowId, data) {
    try {
        return await getPayloadClient().create({ collection: CASE_WORKFLOWS, data: { case: Number(caseId), ...data } });
    } catch (err) {
        const row = await rowFor(caseId, workflowId);
        if (!row) throw err;
        return row;
    }
}

export default function caseWorkflowRequestRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // Public workflows not in the case (admins: plus their own), each marked if already requested.
    app.get('/api/cases/:id/workflows/available', ...auth, asyncHandler(async (req, res) => {
        const { role } = await loadCaseWithAccess(req.params.id, req, REQUEST_MIN_ROLE);
        const requester = requireOwnerId(req);
        const [rows, askedByRequester] = await Promise.all([
            findAll(CASE_WORKFLOWS, { case: { equals: Number(req.params.id) } }),
            requestedBy(req.params.id, requester),
        ]);
        const approvedIds = rows.filter(isApproved).map((r) => Number(r.workflow));
        const where = { and: [
            role === 'admin' ? { or: [PUBLIC, { owner_id: { equals: requester } }] } : PUBLIC,
            ...(approvedIds.length ? [{ id: { not_in: approvedIds } }] : []),
        ] };
        const { docs, hasMore } = await findWorkflowPage(where, workflowPageQuery(req.query));
        const rowByWorkflow = new Map(rows.map((r) => [String(r.workflow), r]));
        const workflows = docs.map((d) => {
            const row = rowByWorkflow.get(String(d.id));
            const pending = Boolean(row && isPending(row));
            return { ...toWorkflow(d, req), requested: pending, requestedByMe: pending && askedByRequester.has(String(d.id)) };
        });
        res.json({ workflows, hasMore });
    }));

    // Or join the pending request. Asking after a decline (past inCooldown) reopens the row,
    // keeping the earlier decline for the admin to see.
    app.post('/api/cases/:id/workflows/requests', ...auth, requestRateLimit, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, REQUEST_MIN_ROLE);
        const requester = requireOwnerId(req);
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        if (source.visibility !== VISIBILITY.PUBLIC) throw ValidationError.fromKey('workflow.request_not_public');
        const [existing, asked] = await Promise.all([rowFor(req.params.id, source.id), requestedBy(req.params.id, requester)]);
        if (existing && isApproved(existing)) throw ConflictError.fromKey('workflow.already_in_case');
        if (asked.has(String(source.id))) return res.status(200).json({ requested: true });
        if (inCooldown(existing, source)) throw ConflictError.fromKey('workflow.declined_recently');
        if (asked.size >= MAX_PENDING_PER_MEMBER) throw ConflictError.fromKey('workflow.too_many_pending', { max: MAX_PENDING_PER_MEMBER });

        const opening = !existing || !isPending(existing);
        if (opening) {
            const data = { ...workflowCopy(source), status: REQUEST_STATUS.PENDING, requested_at: new Date().toISOString() };
            if (existing) await getPayloadClient().update({ collection: CASE_WORKFLOWS, id: existing.id, data });
            else await createRow(req.params.id, source.id, data);
        }
        await addRequester(req.params.id, source.id, requester);
        res.status(opening ? 201 : 200).json({ requested: true });
    }));

    // When nobody is left asking, the request goes away.
    app.delete('/api/cases/:id/workflows/requests/:workflowId', ...auth, requestRateLimit, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req);
        const requester = requireOwnerId(req);
        const row = await rowFor(req.params.id, req.params.workflowId);
        if (!row || !isPending(row) || !(await requestedBy(req.params.id, requester)).has(String(row.workflow))) {
            throw NotFoundError.fromKey('workflow.request_not_found');
        }
        const left = await removeRequester(req.params.id, row.workflow, requester);
        if (!left) await getPayloadClient().delete({ collection: CASE_WORKFLOWS, id: row.id });
        res.status(204).end();
    }));

    app.post('/api/cases/:id/workflows/:rowId/decline', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const row = await loadCaseWorkflowRow(req.params.id, req.params.rowId);
        if (!isPending(row)) throw ConflictError.fromKey('workflow.decline_not_pending');
        const reason = sanitizeText(req.body?.reason, { field: 'workflow.fields.decline_reason', max: 500 });
        await decideRequesters(row, caseDoc, REQUEST_STATUS.DECLINED, reason);
        await getPayloadClient().update({
            collection: CASE_WORKFLOWS,
            id: row.id,
            data: {
                status: REQUEST_STATUS.DECLINED,
                decline_reason: reason || null,
                decided_by: requireOwnerId(req),
                decided_at: new Date().toISOString(),
            },
        });
        res.status(204).end();
    }));

    app.get('/api/workflow-requests/pending', ...auth, asyncHandler(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const rows = await pendingOnAdministeredCases(req);
        const caseIdsWithRequests = [...new Set(rows.map((r) => String(r.case)))];
        const cases = caseIdsWithRequests.length ? await findAll('cases', { id: { in: caseIdsWithRequests } }) : [];
        res.json({ requests: await describeRequests(rows, new Map(cases.map((c) => [String(c.id), c]))) });
    }));

    // The bell, polled: requests someone is still asking for. Unlike To do it doesn't check that
    // they're still in the case (that needs their roles), so a request whose requesters have all
    // left still counts until it's decided.
    app.get('/api/workflow-requests/pending-count', ...auth, asyncHandler(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const requesters = await requestersByRequest(await pendingOnAdministeredCases(req));
        const asked = [...requesters].filter(([, subs]) => subs.length).map(([row]) => row.requested_at);
        res.json(bellCount(asked));
    }));
}
