/**
 * Workflows: saved SlicerWeb setups (docs/workflows-design.md). Anyone signed in can create their
 * own; only the owner can change one. Workflows on a case: routes/caseWorkflows.js.
 */

import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient, requirePayload } from '../payload/index.js';
import storage from '../storage/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { IMAGE_MIME, sniffImageType, sendStoredImage } from '../utils/storedImage.js';
import { requireOwnerId, loadOwnedDoc } from '../utils/ownedDocs.js';
import { sanitizeNameList, sanitizeFileExtensions, sanitizeText, sanitizeChoice } from '../utils/validation.js';
import {
    WORKFLOWS, PUBLIC, VISIBILITY, VIEWER, myWorkflows, findWorkflowPage, workflowPageQuery, toWorkflow, sanitizeStartupConfig,
} from '../services/workflows.js';

export const ICON_MAX_BYTES = 256 * 1024;

const iconUploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: ICON_MAX_BYTES, files: 1 } });
/** Multipart field "icon"; too large is a 400, not a 500. */
const iconUpload = (req, res, next) => iconUploader.single('icon')(req, res, (err) => next(
    err?.code === 'LIMIT_FILE_SIZE' ? ValidationError.fromKey('workflow.icon_too_large', { max: ICON_MAX_BYTES / 1024 }) : err,
));

/** Validated fields from a request body; `partial` (PATCH) only takes the fields present. */
export function workflowFields(body = {}, { partial = false } = {}) {
    const has = (key) => !partial || key in body;
    const out = {};
    if (has('name')) out.name = sanitizeText(body.name, { field: 'workflow.fields.name', max: 100, required: true });
    if (has('description')) out.description = sanitizeText(body.description, { field: 'workflow.fields.description', max: 1000 });
    if (has('visibility')) out.visibility = sanitizeChoice(body.visibility ?? VISIBILITY.PRIVATE, Object.values(VISIBILITY), { field: 'workflow.fields.visibility' });
    if (has('extensions')) out.extensions = sanitizeNameList(body.extensions, { field: 'workflow.fields.extensions' });
    if (has('fileTypes')) out.file_types = sanitizeFileExtensions(body.fileTypes);
    if (has('startupConfig')) out.startup_config = sanitizeStartupConfig(body.startupConfig);
    if (has('viewer')) out.viewer = sanitizeChoice(body.viewer ?? VIEWER.SLICERWEB, Object.values(VIEWER), { field: 'workflow.fields.viewer' });
    return out;
}

export default function workflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // Own workflows come all at once (the browser searches them). ?scope=public can grow without
    // limit, so it's searched and paged here (?q=&sort=&page=).
    app.get('/api/workflows', ...auth, asyncHandler(async (req, res) => {
        if (req.query.scope !== VISIBILITY.PUBLIC) {
            const docs = await myWorkflows(req);
            return res.json({ workflows: docs.map((d) => toWorkflow(d, req)), hasMore: false });
        }
        const { docs, hasMore } = await findWorkflowPage(PUBLIC, workflowPageQuery(req.query));
        res.json({ workflows: docs.map((d) => toWorkflow(d, req)), hasMore });
    }));

    app.get('/api/workflows/:id', ...auth, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req, { write: false });
        res.json({ workflow: toWorkflow(doc, req) });
    }));

    app.post('/api/workflows', ...auth, asyncHandler(async (req, res) => {
        const data = { ...workflowFields(req.body), owner_id: requireOwnerId(req) };
        const doc = await getPayloadClient().create({ collection: WORKFLOWS, data });
        res.status(201).json({ workflow: toWorkflow(doc, req) });
    }));

    app.patch('/api/workflows/:id', ...auth, asyncHandler(async (req, res) => {
        await loadOwnedDoc(WORKFLOWS, req.params.id, req);
        const data = workflowFields(req.body, { partial: true });
        const doc = await getPayloadClient().update({ collection: WORKFLOWS, id: req.params.id, data });
        res.json({ workflow: toWorkflow(doc, req) });
    }));

    // Cases that approved it keep their copy.
    app.delete('/api/workflows/:id', ...auth, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req);
        if (doc.icon_key) await storage.delete(doc.icon_key).catch(() => {});
        await getPayloadClient().delete({ collection: WORKFLOWS, id: req.params.id });
        res.status(204).end();
    }));

    // Icon: anyone who can see the workflow can see it; only the owner can change it.
    app.get('/api/workflows/:id/icon', ...auth, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req, { write: false });
        if (!doc.icon_key) throw NotFoundError.fromKey('workflow.icon_not_found');
        await sendStoredImage(res, doc.icon_key, { cacheControl: 'private, max-age=86400' });
    }));

    app.put('/api/workflows/:id/icon', ...auth, iconUpload, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req);
        const type = sniffImageType(req.file?.buffer);
        if (!type) throw ValidationError.fromKey('workflow.icon_type');
        const key = storage.workflowIconKey(doc.id, Date.now().toString(36), type);
        await storage.write({ key, buffer: req.file.buffer, contentType: IMAGE_MIME[type] });
        if (doc.icon_key) await storage.delete(doc.icon_key).catch(() => {});
        const saved = await getPayloadClient().update({ collection: WORKFLOWS, id: doc.id, data: { icon_key: key } });
        res.json({ workflow: toWorkflow(saved, req) });
    }));

    app.delete('/api/workflows/:id/icon', ...auth, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req);
        if (doc.icon_key) await storage.delete(doc.icon_key).catch(() => {});
        const saved = await getPayloadClient().update({ collection: WORKFLOWS, id: doc.id, data: { icon_key: null } });
        res.json({ workflow: toWorkflow(saved, req) });
    }));
}
