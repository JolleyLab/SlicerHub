/**
 * Workflows on a case (docs/workflows-design.md): which ones members can launch, case admins
 * approving and removing them, and the case's workflow settings. An approval keeps a copy of
 * the workflow as approved.
 *
 *   GET    /api/cases/:id/workflows               members: approved, their own, their requests, default, settings,
 *                                                 and what each viewer can run (services/viewerCapabilities.js)
 *                                                 (admins: + pending requests)
 *   POST   /api/cases/:id/workflows               admins: approve, or re-approve to refresh the copy
 *   DELETE /api/cases/:id/workflows/:approvalId   admins
 *   PATCH  /api/cases/:id/workflow-settings       admins: { defaultWorkflow?, allowPersonal? }
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { ConflictError, ValidationError } from '../utils/errors.js';
import { loadCaseWithAccess } from '../utils/caseAccess.js';
import { requireOwnerId, canView, loadOwnedDoc } from '../utils/ownedDocs.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, findAll, myWorkflows, toWorkflow, isApproved, toApproval, workflowCopy,
} from '../services/workflows.js';
import {
    canRequest, isPending, requestersOf, loadCaseWorkflowRow, describeRequests, notifyRequesters,
} from '../services/workflowRequests.js';
import { viewerCapabilities } from '../services/viewerCapabilities.js';

const caseRows = (caseId) => findAll(CASE_WORKFLOWS, { case: { equals: Number(caseId) } }, 'name');

/**
 * The case's settings as the API returns them: the default workflow (an approval id, or null for
 * none) and whether members may use their own workflows (yes unless turned off).
 */
const caseSettings = (caseDoc) => ({
    defaultWorkflow: caseDoc.default_workflow || null,
    allowPersonal: caseDoc.allow_personal_workflows !== false,
});

export default function caseWorkflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // What a member can launch on this case: the approved workflows, and their own (unless the
    // case turns those off), plus the case's default and their own pending requests. Admins also
    // get every pending request. ("Find more…" lists what could be added: routes/caseWorkflowRequests.js.)
    app.get('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc, role } = await loadCaseWithAccess(req.params.id, req);
        const canManage = role === 'admin';
        const settings = caseSettings(caseDoc);
        const [rows, mine] = await Promise.all([caseRows(req.params.id), myWorkflows(req)]);
        const approvals = rows.filter(isApproved);
        const sourceIds = [...new Set(approvals.map((a) => a.workflow))];
        const sources = sourceIds.length
            ? (await findAll(WORKFLOWS, { id: { in: sourceIds } })).filter((d) => canView(d, req))
            : [];
        const sourceById = new Map(sources.map((d) => [String(d.id), d]));
        const me = requireOwnerId(req);
        const pending = rows.filter(isPending);
        res.json({
            approved: approvals.map((a) => toApproval(a, sourceById.get(String(a.workflow)))),
            mine: settings.allowPersonal ? mine.map((d) => toWorkflow(d, req)) : [],
            myRequests: pending.filter((r) => requestersOf(r).includes(me)).map((r) => ({ workflowId: r.workflow, name: r.name })),
            ...settings,
            canManage,
            canRequest: canRequest(role),
            viewers: viewerCapabilities(),
            ...(canManage ? { requests: await describeRequests(pending, new Map([[String(caseDoc.id), caseDoc]])) } : {}),
        });
    }));

    // Approve (or re-approve, refreshing the copy) a public workflow or one of the admin's own.
    // Approving a pending request tells its requesters.
    app.post('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        const data = {
            case: Number(req.params.id),
            ...workflowCopy(source),
            status: 'approved',
            requesters: [],
            requested_at: null,
            decline_reason: null,
            decided_by: requireOwnerId(req),
            decided_at: new Date().toISOString(),
        };
        const payload = getPayloadClient();
        const [existing] = await findAll(CASE_WORKFLOWS, {
            case: { equals: data.case }, workflow: { equals: data.workflow },
        });
        if (existing && isPending(existing)) await notifyRequesters(existing, caseDoc, 'approved');
        const row = existing
            ? await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data })
            : await payload.create({ collection: CASE_WORKFLOWS, data });
        res.status(existing ? 200 : 201).json({ approval: toApproval(row) });
    }));

    // Removing the default workflow also clears the default. A request is declined instead, so its
    // requesters are told.
    app.delete('/api/cases/:id/workflows/:approvalId', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const row = await loadCaseWorkflowRow(req.params.id, req.params.approvalId);
        if (isPending(row)) throw new ConflictError('Decline a pending request instead of removing it');
        const payload = getPayloadClient();
        await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
        if (String(caseDoc.default_workflow) === String(row.id)) {
            await payload.update({ collection: 'cases', id: caseDoc.id, data: { default_workflow: null } });
        }
        res.status(204).end();
    }));

    // Case Settings: the default workflow (one of the case's approved ones, or none) and whether
    // members may use their own workflows.
    app.patch('/api/cases/:id/workflow-settings', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const body = req.body || {};
        const data = {};
        if ('defaultWorkflow' in body) {
            const id = String(body.defaultWorkflow ?? '').trim();
            const approved = (await caseRows(req.params.id)).filter(isApproved);
            if (id && !approved.some((r) => String(r.id) === id)) throw ValidationError.fromKey('workflow.default_not_in_case');
            data.default_workflow = id || null;
        }
        if ('allowPersonal' in body) {
            if (typeof body.allowPersonal !== 'boolean') throw ValidationError.fromKey('workflow.allow_personal_boolean');
            data.allow_personal_workflows = body.allowPersonal;
        }
        const saved = Object.keys(data).length
            ? await getPayloadClient().update({ collection: 'cases', id: caseDoc.id, data })
            : caseDoc;
        res.json(caseSettings(saved));
    }));
}
