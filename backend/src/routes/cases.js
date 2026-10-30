import path from 'path';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import storage from '../storage/index.js';
import { attachmentOpenFlags } from '../utils/attachmentFlags.js';
import { assertCaseAccess, buildCaseRoleMap } from '../utils/caseAccess.js';
import { getKeycloakSubForUser, getKeycloakUser, kcDisplayName } from '../services/keycloakAdmin.js';
import { listRecentActivityKC } from '../services/recentActivity.js';
import { findLink } from '../auth/identityStore.js';
import { createNotification } from '../services/notifications.js';
import { stageCachedFileForSlicerGui, readSlicerGuiBusyStatus } from '../slicerGui/stageFile.js';
import { buildSlicerGuiViewerPath, writeLastLoadedFile, readLoadResultFile } from '../slicerGui/paths.js';
import {
    ensureSlicerGuiSession,
    touchSlicerGuiSessionHeartbeat,
    releaseSlicerGuiSession,
} from '../slicerGui/sessionManager.js';
import { patchSessionMetadata } from '../sessions/leaseRegistry.js';
import { getSessionTtlSeconds, getWarmIdleTtlSeconds } from '../sessions/index.js';
import { normalizeViewerReleaseMode } from '../sessions/config.js';
import { SESSION_KINDS } from '../sessions/kinds.js';
import { msg } from '../i18n/index.js';
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

    // ── Full Slicer session management ─────────────────────────────────────
    // Must be registered before /api/cases/:id to avoid the static segments
    // being captured as the id parameter.

    app.get('/api/cases/full-slicer-status', authenticateToken, asyncHandler(async (req, res) => {
        const seatId = parseOptionalSeatId(req.query?.seatId) || 1;
        const userId = String(req.user.id);
        const status = readSlicerGuiBusyStatus(userId, seatId);
        if (!status.busy) {
            const loadResult = readLoadResultFile(userId, seatId);
            return res.json({ ...status, loadResult: loadResult || null });
        }
        res.json(status);
    }));

    app.post('/api/cases/full-slicer-heartbeat', authenticateToken, asyncHandler(async (req, res) => {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError(msg('viewer.session_token_missing'), null, 'viewer.session_token_missing');
        }

        const userId = String(req.user.id);
        const lease = touchSlicerGuiSessionHeartbeat({
            userId,
            sessionToken,
            seatId: parseOptionalSeatId(req.body?.seatId),
        });
        if (!lease) {
            return res.status(404).json({
                error: { message: msg('viewer.session_ended') },
            });
        }

        res.json({
            success: true,
            seatId: lease.metadata?.seatId ?? null,
            leaseExpiresAt: new Date(lease.leaseExpiresAt).toISOString(),
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
        });
    }));

    app.post('/api/cases/full-slicer-stop', authenticateToken, asyncHandler(async (req, res) => {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError(msg('viewer.session_token_missing'), null, 'viewer.session_token_missing');
        }

        const mode = normalizeViewerReleaseMode(req.body?.mode, { supportsSoft: true });
        const result = await releaseSlicerGuiSession({
            userId: String(req.user.id),
            sessionToken,
            mode,
        });

        res.json({ success: true, ...result });
    }));

    // ── Cases CRUD ─────────────────────────────────────────────────────────

    /**
     * List cases. Admins see all; regular users see their own + cases they collaborate on.
     */
    app.get('/api/cases', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const page  = Math.max(Number(req.query.page)  || 1,  1);

        // Build Keycloak case role map once — efficient single Admin API call
        const keycloakSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        const roleMap = req.user.role === 'admin' ? {} : await buildCaseRoleMap(req);
        const collaboratorCaseIds = Object.keys(roleMap).map(Number);

        let where;
        if (req.user.role === 'admin') {
            where = {};
        } else if (!keycloakSub) {
            where = { id: { equals: -1 } }; // no Keycloak identity → no owned cases visible
        } else if (collaboratorCaseIds.length > 0) {
            where = {
                or: [
                    { owner_id: { equals: keycloakSub } },
                    { id: { in: collaboratorCaseIds } },
                ],
            };
        } else {
            where = { owner_id: { equals: keycloakSub } };
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
                : doc.owner_id === keycloakSub
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
     * Recent invite activity (INVITE_SENT) on cases the current user owns or collaborates on.
     * Keycloak path: no requireDirectusLink needed.
     */
    app.get('/api/cases/activity/recent', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const kcSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        if (!kcSub) {
            return res.json({ events: [] });
        }
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const events = await listRecentActivityKC({ kcSub, limit, payload });
        res.set('Cache-Control', 'no-store');
        res.json({ events });
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
        const ownerSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        if (!ownerSub) throw new ForbiddenError('A Keycloak identity is required to create cases');

        const newCase = await payload.create({
            collection: 'cases',
            data: {
                title,
                description: String(req.body?.description || '').trim() || undefined,
                status:      req.body?.status || 'active',
                owner_id:    ownerSub,
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

    // ── Comment endpoints ───────────────────────────────────────────────────

    /**
     * List comments for a case. Any collaborator can read.
     * Author display names are resolved from Keycloak at read time.
     */
    app.get('/api/cases/:id/comments', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'read_only');

        const result = await payload.find({
            collection: 'case-comments',
            where: { case: { equals: req.params.id } },
            sort: 'createdAt',
            limit: 500,
        });

        // Resolve unique author names from Keycloak (skip sqlite: bridge IDs)
        const uniqueSubs = [...new Set(
            result.docs
                .map(c => c.author_id)
                .filter(id => id && !id.startsWith('sqlite:'))
        )];
        const nameMap = {};
        await Promise.all(uniqueSubs.map(async (sub) => {
            const user = await getKeycloakUser(sub);
            if (user) nameMap[sub] = kcDisplayName(user) || null;
        }));

        const comments = result.docs.map(c => {
            const isKcSub = c.author_id && !c.author_id.startsWith('sqlite:');
            const name = nameMap[c.author_id] || null;
            const author = (isKcSub || name)
                ? { name, avatarUrl: isKcSub ? `/api/users/${encodeURIComponent(c.author_id)}/avatar` : null }
                : undefined;
            return { ...c, author };
        });

        res.set('Cache-Control', 'no-store');
        res.json({ comments });
    }));

    /**
     * Post a comment on a case. Any collaborator may comment.
     * Body: { text: string }
     */
    app.post('/api/cases/:id/comments', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'read_only');

        const body = String(req.body?.text || req.body?.comment || '').trim();
        if (!body) throw new ValidationError('Comment text is required');
        if (body.length > 5000) throw new ValidationError('Comment is too long (max 5000 characters)');

        const authorId = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        if (!authorId) throw new ForbiddenError('A Keycloak identity is required to comment on cases');

        const comment = await payload.create({
            collection: 'case-comments',
            data: {
                case:      parseInt(req.params.id, 10),
                body,
                author_id: authorId,
            },
        });

        // Resolve author name so the frontend can display it immediately
        const kcUser = await getKeycloakUser(authorId);
        const authorName = kcUser ? (kcDisplayName(kcUser) || null) : null;

        // Fire mention notifications for any @<kc-sub-uuid> patterns in the comment body
        const mentionRe = /(?:^|[^/\w])@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
        const mentionedSubs = new Set();
        let m;
        while ((m = mentionRe.exec(body)) !== null) mentionedSubs.add(m[1].toLowerCase());
        if (mentionedSubs.size > 0) {
            const caseTitle = doc.title || 'a case';

            // Resolve @uuid → @DisplayName in the notification body so recipients see names
            const uuidNameMap = new Map();
            for (const sub of mentionedSubs) {
                try {
                    const kcUser = await getKeycloakUser(sub);
                    if (kcUser) {
                        const name = kcDisplayName(kcUser, sub);
                        uuidNameMap.set(sub, name);
                    }
                } catch { /* keep uuid on lookup failure */ }
            }
            let resolvedBody = body;
            for (const [uuid, name] of uuidNameMap) {
                resolvedBody = resolvedBody.replace(new RegExp(`@${uuid}`, 'gi'), `@${name}`);
            }
            const notifBody = resolvedBody.slice(0, 200);

            for (const sub of mentionedSubs) {
                if (sub === authorId) continue; // don't notify yourself
                try {
                    const link = findLink('keycloak', sub);
                    if (!link) continue;
                    createNotification({
                        userId: link.user_id,
                        type: 'mention',
                        title: `${authorName || 'Someone'} mentioned you in "${caseTitle}"`,
                        body: notifBody,
                        caseId: String(req.params.id),
                    });
                } catch (err) {
                    console.warn('[cases] mention notification skipped:', err.message);
                }
            }
        }

        res.status(201).json({
            comment: {
                ...comment,
                author: authorName ? { name: authorName, avatarUrl: `/api/users/${encodeURIComponent(authorId)}/avatar` } : undefined,
            },
        });
    }));

    /**
     * Stage a Payload attachment into a local Full Slicer seat and return viewer URL.
     * Mirrors /api/directus/cases/:caseId/attachments/:attachmentId/open-local-full-slicer
     * but reads the file from local FileStore (caseFiles/{uploadId}) instead of Directus.
     */
    app.post('/api/cases/:id/attachments/:attachmentId/open-local-full-slicer', ...auth, asyncHandler(async (req, res) => {
        console.log(`[cases] open-local-full-slicer caseId=${req.params.id} attachmentId=${req.params.attachmentId} userId=${req.user?.id}`);
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
        patchSessionMetadata(SESSION_KINDS.SLICER_GUI, session.sessionKey, {
            lastLoadedFileId: stagedKey,
            lastLoadedFileName: staged.fileName,
            sceneLoaded: false,
        });
        writeLastLoadedFile(launcherUserId, {
            fileId: stagedKey,
            fileName: staged.fileName,
            useSimplifiedViewer,
            sceneLoaded: false,
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
