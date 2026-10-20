import path from 'path';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import storage from '../storage/index.js';
import { attachmentOpenFlags } from '../utils/attachmentFlags.js';
import { assertCaseAccess, buildCaseRoleMap } from '../utils/caseAccess.js';
import { stageCachedFileForSlicerGui } from '../slicerGui/stageFile.js';
import { buildSlicerGuiViewerPath } from '../slicerGui/paths.js';
import { ensureSlicerGuiSession } from '../slicerGui/sessionManager.js';
import { getSessionTtlSeconds, getWarmIdleTtlSeconds } from '../sessions/index.js';
import { SESSION_KINDS } from '../sessions/kinds.js';
import { buildViewerFrontendUrl } from '../utils/viewerUrl.js';
import { resolveUseSimplifiedViewer } from '../slicerGui/viewerPreferences.js';

function parseOptionalSeatId(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
}

function requirePayload(req, res, next) {
    if (!getPayloadClient()) {
        return res.status(503).json({
            error: { message: 'Cases service not available — start with --profile payload to enable' }
        });
    }
    next();
}


export default function casesRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    /**
     * List cases. Admins see all; regular users see their own + cases they collaborate on.
     */
    app.get('/api/cases', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const page  = Math.max(Number(req.query.page)  || 1,  1);

        // Build Keycloak case role map once — efficient single Admin API call
        const roleMap = req.user.role === 'admin' ? {} : await buildCaseRoleMap(req);
        const collaboratorCaseIds = Object.keys(roleMap).map(Number);

        let where;
        if (req.user.role === 'admin') {
            where = {};
        } else if (collaboratorCaseIds.length > 0) {
            where = {
                or: [
                    { owner_id: { equals: req.user.id } },
                    { id: { in: collaboratorCaseIds } },
                ],
            };
        } else {
            where = { owner_id: { equals: req.user.id } };
        }

        const result = await payload.find({
            collection: 'cases',
            where,
            limit,
            page,
            sort: '-createdAt',
        });

        // Annotate each case with the current user's effective role
        const cases = result.docs.map(doc => ({
            ...doc,
            myRole: req.user.role === 'admin'
                ? 'admin'
                : doc.owner_id === req.user.id
                    ? 'admin'
                    : (roleMap[String(doc.id)] ?? null),
        }));

        res.set('Cache-Control', 'no-store');
        res.json({
            cases,
            meta: {
                total:      result.totalDocs,
                page:       result.page,
                totalPages: result.totalPages,
                source:     'payload:case',
            },
        });
    }));

    /**
     * Get a single case by ID. Any collaborator can read.
     */
    app.get('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'read_only');

        res.set('Cache-Control', 'no-store');
        res.json({ case: doc });
    }));

    /**
     * Create a case owned by the logged-in user.
     * Body: { title: string, description?: string, status?: 'active'|'archived' }
     */
    app.post('/api/cases', ...auth, asyncHandler(async (req, res) => {
        const title = String(req.body?.title || '').trim();
        if (!title) throw new ValidationError('Title is required');

        const payload = getPayloadClient();
        const newCase = await payload.create({
            collection: 'cases',
            data: {
                title,
                description: String(req.body?.description || '').trim() || undefined,
                status:      req.body?.status || 'active',
                owner_id:    req.user.id,
            },
        });

        res.status(201).json({ case: newCase });
    }));

    /**
     * Update a case. Owner or admin only.
     * Body: any subset of { title, description, status }
     */
    app.patch('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload  = getPayloadClient();
        const existing = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!existing) throw new NotFoundError('Case not found');
        await assertCaseAccess(existing, req, 'admin');

        const updates = {};
        if (req.body?.title       !== undefined) updates.title       = String(req.body.title).trim();
        if (req.body?.description !== undefined) updates.description = req.body.description;
        if (req.body?.status      !== undefined) updates.status      = req.body.status;

        if (Object.keys(updates).length === 0) {
            return res.json({ case: existing });
        }

        const updated = await payload.update({ collection: 'cases', id: req.params.id, data: updates });
        res.json({ case: updated });
    }));

    /**
     * Delete a case. Owner or admin only.
     * Also deletes all attachments and their stored files.
     */
    app.delete('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload  = getPayloadClient();
        const existing = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!existing) throw new NotFoundError('Case not found');
        await assertCaseAccess(existing, req, 'admin');

        // Remove attachment files from storage before deleting records
        const attachments = await payload.find({
            collection: 'attachments',
            where: { case: { equals: req.params.id } },
            limit: 1000,
        });
        for (const att of attachments.docs) {
            await storage.delete(att.storage_key).catch(() => {});
        }

        await payload.delete({ collection: 'cases', id: req.params.id });
        res.status(204).end();
    }));

    // ── Attachment endpoints ────────────────────────────────────────────────

    /**
     * List attachments for a case. Any collaborator can read.
     */
    app.get('/api/cases/:id/attachments', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'read_only');

        const result = await payload.find({
            collection: 'attachments',
            where: { case: { equals: req.params.id } },
            sort: 'createdAt',
            limit: 500,
        });

        const attachments = result.docs.map((att) => ({
            ...att,
            ...attachmentOpenFlags(att.original_filename, att.mime_type),
        }));

        res.set('Cache-Control', 'no-store');
        res.json({ attachments });
    }));

    /**
     * Download a single attachment. Owner or admin only.
     * Returns a presigned URL redirect (object backend) or streams bytes (local).
     */
    app.get('/api/cases/:id/attachments/:attachmentId', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();

        const caseDoc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!caseDoc) throw new NotFoundError('Case not found');
        await assertCaseAccess(caseDoc, req, 'read_only');

        const att = await payload.findByID({ collection: 'attachments', id: req.params.attachmentId });
        if (!att || String(att.case?.id ?? att.case) !== String(req.params.id)) {
            throw new NotFoundError('Attachment not found');
        }

        const presigned = await storage.getPresignedReadUrl(att.storage_key, 300);
        if (presigned) {
            return res.redirect(302, presigned);
        }

        const stream = await storage.openReadStream(att.storage_key);
        res.setHeader('Content-Type',        att.mime_type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(att.original_filename)}"`);
        if (att.size_bytes) res.setHeader('Content-Length', att.size_bytes);
        stream.pipe(res);
    }));

    /**
     * Delete an attachment. Owner or admin only.
     */
    app.delete('/api/cases/:id/attachments/:attachmentId', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();

        const caseDoc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!caseDoc) throw new NotFoundError('Case not found');
        await assertCaseAccess(caseDoc, req, 'admin');

        const att = await payload.findByID({ collection: 'attachments', id: req.params.attachmentId });
        if (!att || String(att.case?.id ?? att.case) !== String(req.params.id)) {
            throw new NotFoundError('Attachment not found');
        }

        await storage.delete(att.storage_key).catch(() => {});
        await payload.delete({ collection: 'attachments', id: req.params.attachmentId });
        res.status(204).end();
    }));

    /**
     * Stage a Payload attachment into a local Full Slicer seat and return viewer URL.
     * Mirrors /api/directus/cases/:caseId/attachments/:attachmentId/open-local-full-slicer
     * but reads the file from local FileStore (caseFiles/{uploadId}) instead of Directus.
     */
    app.post('/api/cases/:id/attachments/:attachmentId/open-local-full-slicer', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();

        const caseDoc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!caseDoc) throw new NotFoundError('Case not found');
        await assertCaseAccess(caseDoc, req, 'read_only');

        const att = await payload.findByID({ collection: 'attachments', id: req.params.attachmentId });
        if (!att || String(att.case?.id ?? att.case) !== String(req.params.id)) {
            throw new NotFoundError('Attachment not found');
        }

        const { canOpenInSlicer } = attachmentOpenFlags(att.original_filename, att.mime_type);
        if (!canOpenInSlicer) {
            throw new ValidationError('This file type cannot be opened in Slicer');
        }

        // FileStore writes files flat: storage_key = 'caseFiles/{uploadId}' → resolve from CWD
        const sourcePath = path.resolve(att.storage_key);
        const fileName = att.original_filename;

        const useSimplifiedViewer = resolveUseSimplifiedViewer({ body: req.body, userId: req.user.id });
        const launcherUserId = String(req.user.id);
        const seatId = parseOptionalSeatId(req.body?.seatId);

        let session;
        try {
            session = await ensureSlicerGuiSession({
                userId: launcherUserId,
                seatId,
                useSimplifiedViewer,
                requireSlicerUiReady: false,
            });
        } catch (err) {
            console.warn('[cases] Full Slicer seat failed:', err.message || err);
            throw new ValidationError("Couldn't start the viewer. Please try again in a moment.");
        }

        const stagedKey = `pl-${att.id}`;
        const staged = await stageCachedFileForSlicerGui({
            sourcePath,
            stagedKey,
            fileName,
            launcherUserId,
            useSimplifiedViewer,
            seatId: session.seatId,
        });

        const viewerPath = buildSlicerGuiViewerPath(launcherUserId, session.seatId);
        const frontendUrl = buildViewerFrontendUrl(req, launcherUserId, null, null);
        const origin = frontendUrl
            ? new URL(frontendUrl).origin
            : `${req.protocol}://${req.get('host')}`;
        const slicerGuiUrl = `${origin}${viewerPath.startsWith('/') ? viewerPath : `/${viewerPath}`}`;

        res.json({
            slicerGuiUrl,
            vncPath: viewerPath,
            sessionId: session.containerName,
            sessionToken: session.sessionToken,
            seatId: session.seatId,
            maxSeats: session.maxSeats,
            userId: launcherUserId,
            fileName: staged.fileName,
            containerPath: staged.containerPath || null,
            useSimplifiedViewer,
            sessionReused: session.reused === true,
            sceneReloaded: true,
            stagedKey,
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
            warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI),
        });
    }));
}
