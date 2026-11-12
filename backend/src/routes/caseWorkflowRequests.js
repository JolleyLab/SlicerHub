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
    REQUEST_MIN_ROLE, isPending, requestersOf, loadCaseWorkflowRow, describeRequests, notifyRequesters,
} from '../services/workflowRequests.js';

const rowFor = async (caseId, workflowId) => (await findAll(CASE_WORKFLOWS, {
    case: { equals: Number(caseId) }, workflow: { equals: String(workflowId) },
}))[0] || null;

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
        const [rows, everyonePublic, mine] = await Promise.all([
            findAll(CASE_WORKFLOWS, { case: { equals: Number(req.params.id) } }),
            publicWorkflows(),
            role === 'admin' ? myWorkflows(req) : [],
        ]);
        const rowByWorkflow = new Map(rows.map((r) => [String(r.workflow), r]));
        const me = requireOwnerId(req);
        const workflows = [...new Map([...everyonePublic, ...mine].map((d) => [String(d.id), d])).values()]
            .filter((d) => !(rowByWorkflow.has(String(d.id)) && isApproved(rowByWorkflow.get(String(d.id)))))
            .filter((d) => matchesQuery(d, q) && matchesFileTypes(d, fileTypes))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((d) => {
                const row = rowByWorkflow.get(String(d.id));
                const pending = Boolean(row && isPending(row));
                return { ...toWorkflow(d, req), requested: pending, requestedByMe: pending && requestersOf(row).includes(me) };
            });
        res.json({ workflows });
    }));

    // Request a public workflow, or join the pending request for it. Asking again after a
    // decline reopens the row, keeping the earlier decline for the admin to see.
    app.post('/api/cases/:id/workflows/requests', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, REQUEST_MIN_ROLE);
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        if (source.visibility !== 'public') throw new ValidationError('Only public workflows can be requested');
        const me = requireOwnerId(req);
        const payload = getPayloadClient();
        const existing = await rowFor(req.params.id, source.id);
        if (existing && isApproved(existing)) throw new ConflictError('This workflow is already available in this case');

        if (existing && isPending(existing)) {
            const requesters = [...new Set([...requestersOf(existing), me])];
            await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data: { requesters } });
            return res.json({ requested: true });
        }
        const data = {
            ...workflowCopy(source),
            status: 'pending',
            requesters: [me],
            requested_at: new Date().toISOString(),
        };
        if (existing) await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data });
        else await payload.create({ collection: CASE_WORKFLOWS, data: { case: Number(req.params.id), ...data } });
        res.status(201).json({ requested: true });
    }));

    // Cancel my request. When nobody is left, the request goes away.
    app.delete('/api/cases/:id/workflows/requests/:workflowId', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req);
        const me = requireOwnerId(req);
        const row = await rowFor(req.params.id, req.params.workflowId);
        if (!row || !isPending(row) || !requestersOf(row).includes(me)) throw new NotFoundError('Not found');
        const requesters = requestersOf(row).filter((sub) => sub !== me);
        const payload = getPayloadClient();
        if (requesters.length) await payload.update({ collection: CASE_WORKFLOWS, id: row.id, data: { requesters } });
        else await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
        res.status(204).end();
    }));

    app.post('/api/cases/:id/workflows/:rowId/decline', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const row = await loadCaseWorkflowRow(req.params.id, req.params.rowId);
        if (!isPending(row)) throw new ConflictError('Only a pending request can be declined');
        const reason = sanitizeText(req.body?.reason, { label: 'Reason', max: 500 });
        await notifyRequesters(row, caseDoc, 'declined', reason);
        await getPayloadClient().update({
            collection: CASE_WORKFLOWS,
            id: row.id,
            data: {
                status: 'declined',
                requesters: [],
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
