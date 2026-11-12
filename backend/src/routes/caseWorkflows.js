/**
 * Workflows on a case (docs/workflows-design.md): which ones members can launch, case admins
 * approving and removing them, and the case's workflow settings. An approval keeps a copy of
 * the workflow as approved.
 *
 *   GET    /api/cases/:id/workflows               members: approved, their own, defaults, settings (admins: + available)
 *   POST   /api/cases/:id/workflows               admins: approve, or re-approve to refresh the copy
 *   DELETE /api/cases/:id/workflows/:approvalId   admins
 *   PATCH  /api/cases/:id/workflow-settings       admins: { defaults?, allowPersonal? }
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { loadCaseWithAccess } from '../utils/caseAccess.js';
import { requireOwnerId, canView, loadOwnedDoc } from '../utils/ownedDocs.js';
import { isDocId } from '../utils/validation.js';
import {
    WORKFLOWS, CASE_WORKFLOWS, BUILTIN_WORKFLOW_IDS, findAll, myWorkflows, publicWorkflows, toWorkflow,
    isApproved, toApproval, workflowCopy, sanitizeWorkflowDefaults, withoutDefault,
} from '../services/workflows.js';

const caseRows = (caseId) => findAll(CASE_WORKFLOWS, { case: { equals: Number(caseId) } }, 'name');

/** The case's settings as the API returns them. Personal workflows are allowed unless turned off. */
const caseSettings = (caseDoc) => ({
    defaults: caseDoc.workflow_defaults || {},
    allowPersonal: caseDoc.allow_personal_workflows !== false,
});

export default function caseWorkflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // What a member can launch on this case: the approved workflows, and their own (unless the
    // case turns those off), plus the case's defaults. Admins also get `available`: what they
    // could approve (their own and public ones, not yet approved).
    app.get('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc, role } = await loadCaseWithAccess(req.params.id, req);
        const canManage = role === 'admin';
        const settings = caseSettings(caseDoc);
        const [rows, mine, everyonePublic] = await Promise.all([
            caseRows(req.params.id),
            myWorkflows(req),
            canManage ? publicWorkflows() : [],
        ]);
        const approvals = rows.filter(isApproved);
        const sourceIds = [...new Set(approvals.map((a) => a.workflow))];
        const sources = sourceIds.length
            ? (await findAll(WORKFLOWS, { id: { in: sourceIds } })).filter((d) => canView(d, req))
            : [];
        const sourceById = new Map(sources.map((d) => [String(d.id), d]));
        const approvedIds = new Set(approvals.map((a) => String(a.workflow)));
        const available = canManage
            ? [...new Map([...mine, ...everyonePublic].map((d) => [String(d.id), d])).values()]
                .filter((d) => !approvedIds.has(String(d.id)))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => toWorkflow(d, req))
            : undefined;
        res.json({
            approved: approvals.map((a) => toApproval(a, sourceById.get(String(a.workflow)))),
            mine: settings.allowPersonal ? mine.map((d) => toWorkflow(d, req)) : [],
            ...settings,
            canManage,
            ...(available ? { available } : {}),
        });
    }));

    // Approve (or re-approve, refreshing the copy) a public workflow or one of the admin's own.
    app.post('/api/cases/:id/workflows', ...auth, asyncHandler(async (req, res) => {
        await loadCaseWithAccess(req.params.id, req, 'admin');
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
        const row = existing
            ? await payload.update({ collection: CASE_WORKFLOWS, id: existing.id, data })
            : await payload.create({ collection: CASE_WORKFLOWS, data });
        res.status(existing ? 200 : 201).json({ approval: toApproval(row) });
    }));

    // Removing an approval also clears the defaults that used it.
    app.delete('/api/cases/:id/workflows/:approvalId', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const payload = getPayloadClient();
        const row = isDocId(req.params.approvalId)
            ? await payload.findByID({ collection: CASE_WORKFLOWS, id: req.params.approvalId, depth: 0, disableErrors: true })
            : null;
        if (!row || String(row.case) !== String(req.params.id)) throw new NotFoundError('Not found');
        await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
        const defaults = caseDoc.workflow_defaults || {};
        const remaining = withoutDefault(defaults, row.id);
        if (Object.keys(remaining).length !== Object.keys(defaults).length) {
            await payload.update({ collection: 'cases', id: caseDoc.id, data: { workflow_defaults: remaining } });
        }
        res.status(204).end();
    }));

    // Case Settings › Workflows: the defaults table and whether members may use their own workflows.
    app.patch('/api/cases/:id/workflow-settings', ...auth, asyncHandler(async (req, res) => {
        const { caseDoc } = await loadCaseWithAccess(req.params.id, req, 'admin');
        const body = req.body || {};
        const data = {};
        if ('defaults' in body) {
            const approvedIds = (await caseRows(req.params.id)).filter(isApproved).map((r) => r.id);
            data.workflow_defaults = sanitizeWorkflowDefaults(body.defaults, [...approvedIds, ...BUILTIN_WORKFLOW_IDS]);
        }
        if ('allowPersonal' in body) {
            if (typeof body.allowPersonal !== 'boolean') throw new ValidationError('allowPersonal must be true or false');
            data.allow_personal_workflows = body.allowPersonal;
        }
        const saved = Object.keys(data).length
            ? await getPayloadClient().update({ collection: 'cases', id: caseDoc.id, data })
            : caseDoc;
        res.json(caseSettings(saved));
    }));
}
