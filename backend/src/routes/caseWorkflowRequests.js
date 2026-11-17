/**
 * Requesting public workflows for a case (docs/workflows-design.md › Requests). Approving is
 * POST /api/cases/:id/workflows (routes/caseWorkflows.js), for requests and direct adds alike.
 *
 *   GET    /api/cases/:id/workflows/available?q=&fileTypes=  members above read_only: what "Find more…" offers
 *   POST   /api/cases/:id/workflows/requests                  members above read_only: { workflowId }
 *   DELETE /api/cases/:id/workflows/requests/:workflowId      a requester cancels their own request
 *   POST   /api/cases/:id/workflows/:rowId/decline            admins: { reason? }
 *   GET    /api/workflow-requests/pending                     requests on cases the user administers
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { loadCaseWithAccess, adminCaseIds } from '../utils/caseAccess.js';
import { requireOwnerId, loadOwnedDoc } from '../utils/ownedDocs.js';
import { sanitizeText } from '../utils/validation.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, findAll, myWorkflows, publicWorkflows, toWorkflow, isApproved, workflowCopy,
} from '../services/workflows.js';
import {
    REQUEST_MIN_ROLE, isPending, loadCaseWorkflowRow, describeRequests, decideRequesters,
    requestedBy, addRequester, removeRequester,
} from '../services/workflowRequests.js';

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

const matchesQuery = (doc, q) => !q
    || `${doc.name} ${doc.description || ''}`.toLowerCase().includes(q);
/** For a file whose name could match any of `fileTypes` ("seg.nrrd", "nrrd"); workflows for any type always match. */
const matchesFileTypes = (doc, fileTypes) => !fileTypes.length
    || !(doc.file_types || []).length || fileTypes.some((ext) => doc.file_types.includes(ext));

export default function caseWorkflowRequestRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // "Find more…": public workflows not yet approved for the case (admins: plus their own, which
    // they can add directly), with whether each is already requested, and by me.
    app.get('/api/cases/:id/workflows/available', ...auth, asyncHandler(async (req, res) => {
        const { role } = await loadCaseWithAccess(req.params.id, req, REQUEST_MIN_ROLE);
        const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
        const fileTypes = String(req.query.fileTypes || '').toLowerCase().split(',')
            .map((ext) => ext.trim().replace(/^\*?\./, '')).filter(Boolean).slice(0, 8);
        const [rows, everyonePublic, mine, askedByMe] = await Promise.all([
            findAll(CASE_WORKFLOWS, { case: { equals: Number(req.params.id) } }),
            publicWorkflows(),
            role === 'admin' ? myWorkflows(req) : [],
            requestedBy(req.params.id, requireOwnerId(req)),
        ]);
        const rowByWorkflow = new Map(rows.map((r) => [String(r.workflow), r]));
        const workflows = [...new Map([...everyonePublic, ...mine].map((d) => [String(d.id), d])).values()]
            .filter((d) => !(rowByWorkflow.has(String(d.id)) && isApproved(rowByWorkflow.get(String(d.id)))))
            .filter((d) => matchesQuery(d, q) && matchesFileTypes(d, fileTypes))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((d) => {
                const row = rowByWorkflow.get(String(d.id));
                const pending = Boolean(row && isPending(row));
                return { ...toWorkflow(d, req), requested: pending, requestedByMe: pending && askedByMe.has(String(d.id)) };
            });
        res.json({ workflows });
    }));

    // Request a public workflow, or join the pending request for it. Asking again after a
    // decline reopens the row, keeping the earlier decline for the admin to see.
    app.post('/api/cases/:id/workflows/requests', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, REQUEST_MIN_ROLE);
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        if (source.visibility !== 'public') throw new ValidationError('Only public workflows can be requested');
        const existing = await rowFor(req.params.id, source.id);
        if (existing && isApproved(existing)) throw new ConflictError('This workflow is already available in this case');

        const opening = !existing || !isPending(existing);
        if (opening) {
            const data = { ...workflowCopy(source), status: 'pending', requested_at: new Date().toISOString() };
            if (existing) await getPayloadClient().update({ collection: CASE_WORKFLOWS, id: existing.id, data });
            else await createRow(req.params.id, source.id, data);
        }
        await addRequester(req.params.id, source.id, requireOwnerId(req));
        res.status(opening ? 201 : 200).json({ requested: true });
    }));

    // Cancel my request. When nobody is left, the request goes away.
    app.delete('/api/cases/:id/workflows/requests/:workflowId', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req);
        const me = requireOwnerId(req);
        const row = await rowFor(req.params.id, req.params.workflowId);
        if (!row || !isPending(row) || !(await requestedBy(req.params.id, me)).has(String(row.workflow))) {
            throw new NotFoundError('Not found');
        }
        const left = await removeRequester(req.params.id, row.workflow, me);
        if (!left) await getPayloadClient().delete({ collection: CASE_WORKFLOWS, id: row.id });
        res.status(204).end();
    }));

    app.post('/api/cases/:id/workflows/:rowId/decline', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const row = await loadCaseWorkflowRow(req.params.id, req.params.rowId);
        if (!isPending(row)) throw new ConflictError('Only a pending request can be declined');
        const reason = sanitizeText(req.body?.reason, { label: 'Reason', max: 500 });
        await decideRequesters(row, caseDoc, 'declined', reason);
        await getPayloadClient().update({
            collection: CASE_WORKFLOWS,
            id: row.id,
            data: {
                status: 'declined',
                decline_reason: reason || null,
                decided_by: requireOwnerId(req),
                decided_at: new Date().toISOString(),
            },
        });
        res.status(204).end();
    }));

    // Home's To do and the bell: pending requests on every case the user administers.
    app.get('/api/workflow-requests/pending', ...auth, asyncHandler(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const caseIds = await adminCaseIds(req);
        if (!caseIds.length) return res.json({ requests: [] });
        const rows = await findAll(CASE_WORKFLOWS, {
            and: [{ case: { in: caseIds } }, { status: { equals: 'pending' } }],
        }, '-requested_at');
        const caseIdsWithRequests = [...new Set(rows.map((r) => String(r.case)))];
        const cases = caseIdsWithRequests.length ? await findAll('cases', { id: { in: caseIdsWithRequests } }) : [];
        res.json({ requests: await describeRequests(rows, new Map(cases.map((c) => [String(c.id), c]))) });
    }));
}
