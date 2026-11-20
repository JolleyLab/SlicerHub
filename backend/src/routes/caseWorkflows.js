/**
 * Workflows on a case (docs/workflows-design.md). An approval keeps a copy of the workflow as approved.
 *
 *   GET    /api/cases/:id/workflows               members: what they can launch, the settings, what each
 *                                                 viewer can run (admins: + pending requests)
 *   POST   /api/cases/:id/workflows               admins: approve, or re-approve to refresh the copy
 *   DELETE /api/cases/:id/workflows/:approvalId   admins
 *   PATCH  /api/cases/:id/workflow-settings       admins: { defaultWorkflow?, allowPersonal? }
 *   PATCH  /api/cases/:id/attachments/:attachmentId/open-with   the uploader or admins: { openWith }
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { loadCaseWithAccess } from '../utils/caseAccess.js';
import { requireOwnerId, canView, loadOwnedDoc } from '../utils/ownedDocs.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, REQUEST_STATUS, isOpenWithKey, findAll, myWorkflows, toWorkflow, isApproved, toApproval, workflowCopy,
} from '../services/workflows.js';
import {
    canRequest, isPending, loadCaseWorkflowRow, describeRequests, decideRequesters, requestedBy,
} from '../services/workflowRequests.js';
import { viewerCapabilities } from '../services/viewerCapabilities.js';
import { SLICER_FILE_TYPES } from '../utils/attachmentFlags.js';

const caseRows = (caseId) => findAll(CASE_WORKFLOWS, { case: { equals: Number(caseId) } }, 'name');

/** The case's settings as the API returns them; personal workflows are allowed unless turned off. */
const caseSettings = (caseDoc) => ({
    defaultWorkflow: caseDoc.default_workflow || null,
    allowPersonal: caseDoc.allow_personal_workflows !== false,
});

export default function caseWorkflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    app.get('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc, role } = await loadCaseWithAccess(req.params.id, req);
        const canManage = role === 'admin';
        const settings = caseSettings(caseDoc);
        const [rows, mine, askedByMe] = await Promise.all([
            caseRows(req.params.id), myWorkflows(req), requestedBy(req.params.id, requireOwnerId(req)),
        ]);
        const approvals = rows.filter(isApproved);
        const sourceIds = [...new Set(approvals.map((a) => a.workflow))];
        const sources = sourceIds.length
            ? (await findAll(WORKFLOWS, { id: { in: sourceIds } })).filter((d) => canView(d, req))
            : [];
        const sourceById = new Map(sources.map((d) => [String(d.id), d]));
        const pending = rows.filter(isPending);
        res.json({
            approved: approvals.map((a) => toApproval(a, sourceById.get(String(a.workflow)))),
            mine: settings.allowPersonal ? mine.map((d) => toWorkflow(d, req)) : [],
            myRequests: pending.filter((r) => askedByMe.has(String(r.workflow))).map((r) => ({ workflowId: r.workflow, name: r.name })),
            ...settings,
            canManage,
            canRequest: canRequest(role),
            viewers: viewerCapabilities(),
            slicerFileTypes: SLICER_FILE_TYPES, // which uploads get asked what they open with
            ...(canManage ? { requests: await describeRequests(pending, new Map([[String(caseDoc.id), caseDoc]])) } : {}),
        });
    }));

    // A public workflow or one of the admin's own. Approving a pending request tells its requesters.
    app.post('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const source = await loadOwnedDoc(WORKFLOWS, String(req.body?.workflowId ?? ''), req, { write: false });
        const data = {
            case: Number(req.params.id),
            ...workflowCopy(source),
            status: REQUEST_STATUS.APPROVED,
            requested_at: null,
            decline_reason: null,
            decided_by: requireOwnerId(req),
            decided_at: new Date().toISOString(),
        };
        const payload = getPayloadClient();
        const [existing] = await findAll(CASE_WORKFLOWS, {
            case: { equals: data.case }, workflow: { equals: data.workflow },
        });
        if (existing && isPending(existing)) await decideRequesters(existing, caseDoc, REQUEST_STATUS.APPROVED);
        const row = existing
            ? await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data })
            : await payload.create({ collection: CASE_WORKFLOWS, data });
        res.status(existing ? 200 : 201).json({ approval: toApproval(row) });
    }));

    // Pending requests are declined instead, so their requesters are told.
    app.delete('/api/cases/:id/workflows/:approvalId', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const row = await loadCaseWorkflowRow(req.params.id, req.params.approvalId);
        if (isPending(row)) throw ConflictError.fromKey('workflow.remove_pending');
        const payload = getPayloadClient();
        await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
        if (String(caseDoc.default_workflow) === String(row.id)) {
            await payload.update({ collection: 'cases', id: caseDoc.id, data: { default_workflow: null } });
        }
        res.status(204).end();
    }));

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

    // A file's default for everyone; null goes back to the case default. Its uploader or an admin.
    app.patch('/api/cases/:id/attachments/:attachmentId/open-with', ...auth, asyncHandler(async (req, res) => {
        const { role } = await loadCaseWithAccess(req.params.id, req, 'collaborator');
        const payload = getPayloadClient();
        const att = await payload.findByID({ collection: 'attachments', id: req.params.attachmentId, depth: 0, disableErrors: true });
        if (!att || String(att.case?.id ?? att.case) !== String(req.params.id)) throw NotFoundError.fromKey('workflow.open_with_file_not_found');
        if (role !== 'admin' && att.uploaded_by !== requireOwnerId(req)) throw ForbiddenError.fromKey('workflow.open_with_not_allowed');
        const openWith = req.body?.openWith ?? null;
        if (openWith !== null && !isOpenWithKey(openWith)) throw ValidationError.fromKey('workflow.open_with_invalid');
        const saved = await payload.update({ collection: 'attachments', id: att.id, data: { open_with: openWith } });
        res.json({ openWith: saved.open_with || null });
    }));
}
