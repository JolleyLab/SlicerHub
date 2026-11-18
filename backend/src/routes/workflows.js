/**
 * Workflows: saved SlicerWeb setups (docs/workflows-design.md). Anyone signed in can list and
 * create their own (?scope=public: everyone's public ones, paged: ?q=&sort=&page=); only the owner
 * can change one.
 * Workflows on a case are in routes/caseWorkflows.js.
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
    WORKFLOWS, PUBLIC, myWorkflows, findWorkflowPage, workflowPageQuery, toWorkflow, sanitizeStartupConfig,
} from '../services/workflows.js';

export const VISIBILITIES = ['private', 'public'];
export const ICON_MAX_BYTES = 256 * 1024;

const iconUploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: ICON_MAX_BYTES, files: 1 } });
/** Multipart field "icon"; too large is a 400, not a 500. */
const iconUpload = (req, res, next) => iconUploader.single('icon')(req, res, (err) => next(
    err?.code === 'LIMIT_FILE_SIZE' ? new ValidationError(`The icon can be at most ${ICON_MAX_BYTES / 1024} KB`) : err,
));

/** Validated fields from a request body; `partial` (PATCH) only takes the fields present. */
export function workflowFields(body = {}, { partial = false } = {}) {
    const has = (key) => !partial || key in body;
    const out = {};
    if (has('name')) out.name = sanitizeText(body.name, { label: 'Name', max: 100, required: true });
    if (has('description')) out.description = sanitizeText(body.description, { label: 'Description', max: 1000 });
    if (has('visibility')) out.visibility = sanitizeChoice(body.visibility ?? 'private', VISIBILITIES, { label: 'Visibility' });
    if (has('extensions')) out.extensions = sanitizeNameList(body.extensions, { label: 'Extensions' });
    if (has('fileTypes')) out.file_types = sanitizeFileExtensions(body.fileTypes);
    if (has('startupConfig')) out.startup_config = sanitizeStartupConfig(body.startupConfig);
    return out;
}

export default function workflowRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    // The requester's own workflows come all at once (one person's list stays small; the browser
    // searches and sorts it). ?scope=public is everyone's public workflows, which can grow without
    // limit, so the server searches and sorts them and returns one page at a time (?q=&sort=&page=).
    app.get('/api/workflows', ...auth, asyncHandler(async (req, res) => {
        if (req.query.scope !== 'public') {
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
        if (!doc.icon_key) throw new NotFoundError('Not found');
        await sendStoredImage(res, doc.icon_key, { cacheControl: 'private, max-age=86400' });
    }));

    app.put('/api/workflows/:id/icon', ...auth, iconUpload, asyncHandler(async (req, res) => {
        const doc = await loadOwnedDoc(WORKFLOWS, req.params.id, req);
        const type = sniffImageType(req.file?.buffer);
        if (!type) throw new ValidationError('The icon must be a PNG, JPEG, GIF or WebP image');
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
