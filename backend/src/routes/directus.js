import path from 'path';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import config from '../config/index.js';
import db from '../db/database.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import {
    listCases,
    isDirectusUrlConfigured,
    getCaseAttachment,
    ensureDirectusAssetCached,
    findCachedDirectusAsset,
    fetchDirectusAsset,
    canOpenAttachmentInSlicer,
    createCaseComment,
    createCase,
    updateCase,
    createCaseAttachment,
    deleteCaseAttachment,
    fetchDirectusViewer,
    lookupDirectusUserByEmail,
    findDirectusUserById
} from '../services/directus.js';
import { getCaseCollabActorContext, setCaseCollaborators } from '../services/caseCollaborators.js';
import { attachUploadedFileToCase } from '../services/attachUploadedFile.js';
import { issueUploadToken } from '../services/uploadTokens.js';
import { listInvitesAwaitingApproval } from '../services/pendingApprovals.js';
import { listRecentActivity } from '../services/recentActivity.js';
import { createAttachmentDownloadHandler } from '../services/attachmentDownload.js';
import {
    inviteExistingUserToCase,
    listOpenInvitesForCase,
    approveCaseInvite,
    rejectCaseInvite
} from '../services/caseInvites.js';
import { getInvite } from '../services/caseInviteStore.js';
import {
    approveSignupInvite,
    rejectSignupInvite,
    getSignupInvitePreview,
    acceptSignupInvite
} from '../services/caseSignupInvites.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import {
    listNotificationsForUser,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotificationForUser,
    unreadNotificationCount
} from '../services/notifications.js';
import { msg } from '../i18n/index.js';

import { stageCachedFileForSlicerGui, readSlicerGuiBusyStatus } from '../slicerGui/stageFile.js';
import { buildSlicerGuiViewerPath } from '../slicerGui/paths.js';
import {
    ensureSlicerGuiSession,
    touchSlicerGuiSessionHeartbeat,
    releaseSlicerGuiSession
} from '../slicerGui/sessionManager.js';
import {
    getSessionTtlSeconds,
    getWarmIdleTtlSeconds
} from '../sessions/index.js';
import { normalizeViewerReleaseMode } from '../sessions/config.js';
import { SESSION_KINDS } from '../sessions/kinds.js';
import { buildViewerFrontendUrl } from '../utils/viewerUrl.js';
import { resolveUseSimplifiedViewer } from '../slicerGui/viewerPreferences.js';

function parseOptionalSeatId(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
}

async function ensureLocalFullSlicerSeat(req, { failureMessage, requireSlicerUiReady = true, preferFileId = null } = {}) {
    const useSimplifiedViewer = resolveUseSimplifiedViewer({
        body: req.body,
        userId: req.user.id
    });
    const launcherUserId = String(req.user.id);
    const seatId = parseOptionalSeatId(req.body?.seatId);
    const preferFromBody = preferFileId != null
        ? preferFileId
        : (Number(req.body?.preferFileId) || null);
    try {
        const session = await ensureSlicerGuiSession({
            userId: launcherUserId,
            seatId,
            preferFileId: Number.isInteger(preferFromBody) && preferFromBody > 0
                ? preferFromBody
                : null,
            useSimplifiedViewer,
            requireSlicerUiReady
        });
        return { launcherUserId, useSimplifiedViewer, session };
    } catch (err) {
        console.warn('Full Slicer seat failed:', err.message || err);
        throw new ValidationError(failureMessage || msg('viewer.start_failed'));
    }
}

export default function directusRoutes(app) {
    if (!config.directus.casesEnabled) {
        return;
    }

    // Collab/Cases: product JWT + Directus link + call-as-user access token (no service fallback).
    const collabAuth = [
        authenticateToken,
        requireDirectusLink,
        requireDirectusUserToken
    ];

    /**
     * List Directus cases as the logged-in user's Directus identity.
     */
    app.get('/api/directus/cases', ...collabAuth, asyncHandler(async (req, res) => {
        const [listed, viewer] = await Promise.all([
            listCases({
                limit: req.query.limit,
                accessToken: req.directusAccessToken
            }),
            fetchDirectusViewer(req.directusAccessToken)
        ]);
        const cases = Array.isArray(listed?.cases) ? listed.cases : [];
        const commentsMeta = listed?.commentsMeta || { loaded: false, error: null, count: 0 };
        res.set('Cache-Control', 'no-store');
        res.json({
            cases,
            meta: {
                configured: isDirectusUrlConfigured(),
                source: 'directus:case',
                actingAs: 'user',
                directusUserId: req.directusIdentity?.externalId || null,
                directusViewer: viewer,
                caseCount: cases.length,
                comments: commentsMeta
            }
        });
    }));

    /**
     * Create a new case in Directus as the logged-in user.
     * Body: { title: string, description?: string, status?: string }
     */
    app.post('/api/directus/cases', ...collabAuth, asyncHandler(async (req, res) => {
        const title = String(req.body?.title || '').trim();
        const description = String(req.body?.description || '').trim() || undefined;
        const status = String(req.body?.status || '').trim() || undefined;

        const newCase = await createCase({ title, description, status }, {
            accessToken: req.directusAccessToken
        });
        res.status(201).json({
            case: newCase,
            meta: {
                actingAs: 'user',
                directusUserId: req.directusIdentity?.externalId || null
            }
        });
    }));

    /**
     * Update editable fields on a case (title, description, status).
     * Body: any subset of { title, description, status }
     */
    app.patch('/api/directus/cases/:caseId', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
            if (!caseId) throw new ValidationError(msg('case.id_required'), null, 'case.id_required');

        const updates = {};
        if (req.body?.title !== undefined) updates.title = req.body.title;
        if (req.body?.description !== undefined) updates.description = req.body.description;
        if (req.body?.status !== undefined) updates.status = req.body.status;

        const updated = await updateCase(caseId, updates, {
            accessToken: req.directusAccessToken
        });
        res.json({
            case: updated,
            meta: {
                actingAs: 'user',
                directusUserId: req.directusIdentity?.externalId || null
            }
        });
    }));

    /**
     * Look up a Directus user by exact email (for collaborator invite).
     */
    app.get('/api/directus/users/lookup', ...collabAuth, asyncHandler(async (req, res) => {
        const email = String(req.query.email || '').trim();
        const user = await lookupDirectusUserByEmail(email, {
            accessToken: req.directusAccessToken
        });
        res.set('Cache-Control', 'no-store');
        res.json({ user });
    }));

    /**
     * Invite by email.
     * Existing Directus user → add or pending approval.
     * Unknown email → signup invite (copy-link) or pending approval for new account.
     * Body: { email, role? }
     */
    app.post('/api/directus/cases/:caseId/invites', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
        if (!caseId) throw new ValidationError(msg('case.id_required'), null, 'case.id_required');
        const email = String(req.body?.email || '').trim();
        if (!email) throw new ValidationError(msg('case.email_required'), null, 'case.email_required');

        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
        throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
        }

        const result = await inviteExistingUserToCase({
            caseId,
            email,
            role: req.body?.role || 'collaborator',
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        });

        const statusCode = (result.status === 'pending' || result.status === 'pending_approval')
            ? 202
            : 200;
        res.status(statusCode).json({
            ...result,
            meta: {
                actingAs: 'user',
                directusUserId: String(actorDirectusUserId)
            }
        });
    }));

    /** Open invites for a case (existing users + signup emails). Case admins and collaborators only. */
    app.get('/api/directus/cases/:caseId/invites', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
        if (!caseId) throw new ValidationError(msg('case.id_required'), null, 'case.id_required');
        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
        }
        const ctx = await getCaseCollabActorContext(caseId, {
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        });
        if (!ctx.actorCanInvite) {
            throw new ForbiddenError(msg('case.invite_forbidden'), null, 'case.invite_forbidden');
        }
        res.set('Cache-Control', 'no-store');
        res.json({ invites: await listOpenInvitesForCase(caseId) });
    }));

    /**
     * Approve or reject an invite. The invite id is unique across kinds and must belong to the case in
     * the URL; the service then checks that the caller is an admin of that case.
     */
    const decideInvite = (decision) => asyncHandler(async (req, res) => {
        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
        }
        const caseId = String(req.params.caseId || '').trim();
        const invite = await getInvite(req.params.inviteId);
        if (!invite || invite.caseId !== caseId) {
            throw new NotFoundError(msg('case.invite_pending_not_found'), null, 'case.invite_pending_not_found');
        }
        const args = {
            inviteId: invite.id,
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        };
        const handlers = invite.kind === 'signup'
            ? { approve: approveSignupInvite, reject: rejectSignupInvite }
            : { approve: approveCaseInvite, reject: rejectCaseInvite };
        res.json(await handlers[decision](args));
    });

    app.post('/api/directus/cases/:caseId/invites/:inviteId/approve', ...collabAuth, decideInvite('approve'));
    app.post('/api/directus/cases/:caseId/invites/:inviteId/reject', ...collabAuth, decideInvite('reject'));

    /** Invites, across cases, that the signed-in user can approve or reject (admin of the case). */
    app.get('/api/directus/invites/pending-approval', ...collabAuth, asyncHandler(async (req, res) => {
        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
        }
        const invites = await listInvitesAwaitingApproval({
            isCaseAdmin: async (caseId) => (await getCaseCollabActorContext(caseId, {
                accessToken: req.directusAccessToken,
                actorDirectusUserId: String(actorDirectusUserId)
            })).actorIsAdmin
        });
        res.set('Cache-Control', 'no-store');
        res.json({ invites });
    }));

    /**
     * Recent invite activity (sent, approved) on the cases where the signed-in user is admin or
     * collaborator. Reads through the service token and only needs to know who the user is, so it works
     * even when their own Directus session has expired.
     */
    app.get('/api/directus/activity/recent', authenticateToken, requireDirectusLink, asyncHandler(async (req, res) => {
        const userId = req.directusIdentity?.externalId;
        res.set('Cache-Control', 'no-store');
        res.json({ events: userId ? await listRecentActivity({ userId: String(userId) }) : [] });
    }));

    /** Public: preview a signup invite (no session). */
    app.get('/api/invites/signup/:token', asyncHandler(async (req, res) => {
        const preview = await getSignupInvitePreview(req.params.token);
        res.set('Cache-Control', 'no-store');
        res.json(preview);
    }));

    /** Public: redeem signup invite — creates Directus + app user and issues session. */
    app.post(
        '/api/invites/signup/:token/accept',
        requireAllowedWebOrigin,
        asyncHandler(async (req, res) => {
            const result = await acceptSignupInvite(req, res, {
                token: req.params.token,
                password: req.body?.password,
                username: req.body?.username,
                firstName: req.body?.firstName || req.body?.first_name,
                lastName: req.body?.lastName || req.body?.last_name,
                theme: req.body?.theme
            });
            res.status(201).json(result);
        })
    );

    /** In-app notifications for the signed-in product user. */
    app.get('/api/notifications', authenticateToken, asyncHandler(async (req, res) => {
        const unreadOnly = String(req.query.unread || '') === '1';
        const notifications = listNotificationsForUser(req.user.id, { unreadOnly });
        res.set('Cache-Control', 'no-store');
        res.json({
            notifications,
            unreadCount: unreadNotificationCount(req.user.id)
        });
    }));

    app.post('/api/notifications/:id/read', authenticateToken, asyncHandler(async (req, res) => {
        markNotificationRead(req.user.id, req.params.id);
        res.json({ ok: true, unreadCount: unreadNotificationCount(req.user.id) });
    }));

    /** Remove from inbox only — does not cancel pending invites / work. */
    app.delete('/api/notifications/:id', authenticateToken, asyncHandler(async (req, res) => {
        const removed = deleteNotificationForUser(req.user.id, req.params.id);
        res.json({
            ok: true,
            removed,
            unreadCount: unreadNotificationCount(req.user.id)
        });
    }));

    app.post('/api/notifications/read-all', authenticateToken, asyncHandler(async (req, res) => {
        const updated = markAllNotificationsRead(req.user.id);
        res.json({ ok: true, updated, unreadCount: 0 });
    }));

    /**
     * Replace collaborators on a case.
     * Admins: full replace (add/remove/role). Collaborators: use POST …/invites.
     * Body: { collaborators: [{ userId|id, role }] }  — roles: admin|collaborator|read_only
     */
    app.put('/api/directus/cases/:caseId/collaborators', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
            if (!caseId) throw new ValidationError(msg('case.id_required'), null, 'case.id_required');

        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
        throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
        }

        const raw = req.body?.collaborators;
        if (!Array.isArray(raw)) {
            throw new ValidationError(msg('case.people_list_invalid'), null, 'case.people_list_invalid');
        }
        const collaborators = raw.map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            return {
                userId: entry.userId || entry.id || '',
                role: entry.role || 'collaborator'
            };
        }).filter((entry) => entry?.userId);

        const result = await setCaseCollaborators(caseId, collaborators, {
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        });

        res.json({
            caseId: result.id,
            collaborators: result.collaborators,
            meta: {
                actingAs: 'user',
                directusUserId: String(actorDirectusUserId)
            }
        });
    }));

    /**
     * Start a resumable upload: returns a one-time token bound to the caller, and the metadata the
     * client must send with the upload so the file can be recognised afterwards (see
     * services/uploadTokens.js). The client treats both as opaque.
     */
    app.post(
        '/api/directus/uploads/token',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            res.json(issueUploadToken(req.user.id));
        })
    );

    /**
     * Attach a file already uploaded to Directus (resumable TUS upload, see routes/directusTus.js) to
     * a case. Body: { uploadToken, name?, type?, size? } where uploadToken is the token issued by
     * POST /api/directus/uploads/token for that upload (see services/attachUploadedFile.js).
     */
    app.post(
        '/api/directus/cases/:caseId/attachments/from-upload',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const caseId = String(req.params.caseId || '').trim();
            if (!caseId) throw new ValidationError(msg('case.id_required'), null, 'case.id_required');

            const displayName = String(req.body?.name || '').trim() || 'upload';
            const size = Number(req.body?.size);
            // Only used to fill in the response if Directus does not return the file record.
            const fileMeta = {
                filename_download: displayName,
                type: String(req.body?.type || '') || null,
                filesize: Number.isFinite(size) ? size : null
            };

            const { attachment, fileId } = await attachUploadedFileToCase({
                caseId,
                userId: req.user.id,
                uploadToken: String(req.body?.uploadToken || '').trim(),
                displayName,
                fileMeta,
                accessToken: req.directusAccessToken
            });

            res.status(201).json({
                attachment,
                meta: {
                    actingAs: 'user',
                    directusUserId: req.directusIdentity?.externalId || null,
                    directusFileId: fileId
                }
            });
        })
    );

    /**
     * Delete a case attachment (removes the junction record; the Directus file is kept).
     */
    app.delete(
        '/api/directus/cases/:caseId/attachments/:attachmentId',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const caseId = String(req.params.caseId || '').trim();
            const attachmentId = String(req.params.attachmentId || '').trim();
            if (!caseId || !attachmentId) {
                throw new ValidationError(msg('case.case_and_file_required'), null, 'case.case_and_file_required');
            }

            await deleteCaseAttachment(caseId, attachmentId, {
                accessToken: req.directusAccessToken
            });
            res.status(204).end();
        })
    );

    /**
     * Create a Directus comment as the logged-in user.
     */
    app.post('/api/directus/cases/:caseId/comments', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
        const text = typeof req.body?.comment === 'string'
            ? req.body.comment
            : (typeof req.body?.text === 'string' ? req.body.text : '');

        const comment = await createCaseComment(caseId, text, {
            accessToken: req.directusAccessToken,
            actorAppUserId: req.user.id
        });
        res.status(201).json({
            comment,
            meta: {
                postedByAppUser: {
                    id: req.user.id,
                    username: req.user.username || null,
                    email: req.user.email || null
                },
                directusUserId: req.directusIdentity?.externalId || null,
                actingAs: 'user'
            }
        });
    }));

    /** Name an attachment's asset is cached under (the original file name where there is one). */
    const attachmentDiskName = (attachment) => attachment.filenameDownload || attachment.name || 'attachment.bin';

    /**
     * Check the caller may use this attachment and return it. Directus enforces read access as the
     * caller and getCaseAttachment checks the case/attachment match. With requireEditRole only case
     * admins and collaborators pass (read_only is refused).
     */
    async function authorizeCaseAttachment(req, { requireEditRole = false } = {}) {
        const caseId = String(req.params.caseId || '').trim();
        const attachmentId = String(req.params.attachmentId || '').trim();
        if (!caseId || !attachmentId) {
            throw new ValidationError(msg('case.case_and_file_required'), null, 'case.case_and_file_required');
        }

        const attachment = await getCaseAttachment(caseId, attachmentId, {
            accessToken: req.directusAccessToken
        });

        if (requireEditRole) {
            const actorDirectusUserId = req.directusIdentity?.externalId
                || (await fetchDirectusViewer(req.directusAccessToken))?.id;
            if (!actorDirectusUserId) {
                throw new ValidationError(msg('directus.session_confirm_failed'), null, 'directus.session_confirm_failed');
            }
            const ctx = await getCaseCollabActorContext(caseId, {
                accessToken: req.directusAccessToken,
                actorDirectusUserId: String(actorDirectusUserId)
            });
            if (!ctx.actorCanInvite) { // admin or collaborator
                throw new ForbiddenError(msg('case.download_forbidden'), null, 'case.download_forbidden');
            }
        }
        return attachment;
    }

    /**
     * Attachment bytes for the in-browser viewers (SlicerWeb), for any case member. The whole file is
     * cached first (the viewer needs all of it); served inline and uncacheable. Not a save-to-device
     * path (see /download).
     */
    app.get(
        '/api/directus/cases/:caseId/attachments/:attachmentId/content',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const attachment = await authorizeCaseAttachment(req);
            const cached = await ensureDirectusAssetCached({
                fileId: attachment.fileId,
                filenameDownload: attachmentDiskName(attachment),
                expectedSize: attachment.filesize,
                accessToken: req.directusAccessToken
            });
            res.sendFile(path.resolve(cached.cachePath), {
                headers: {
                    'Content-Disposition': 'inline',
                    'Cache-Control': 'private, no-store'
                }
            });
        })
    );

    /**
     * Save-to-device download of a case attachment. Case admins and collaborators only; read_only
     * members may view files in a viewer but not copy them off the platform. HEAD is the browser's
     * quick access check; GET serves the cached copy or streams from Directus as bytes arrive (see
     * services/attachmentDownload.js).
     */
    app.get(
        '/api/directus/cases/:caseId/attachments/:attachmentId/download',
        ...collabAuth,
        asyncHandler(createAttachmentDownloadHandler({
            authorize: (req) => authorizeCaseAttachment(req, { requireEditRole: true }),
            findCached: (attachment) => findCachedDirectusAsset({
                fileId: attachment.fileId,
                filenameDownload: attachmentDiskName(attachment),
                expectedSize: attachment.filesize
            }),
            fetchAsset: (attachment, accessToken, signal) => fetchDirectusAsset(attachment.fileId, accessToken, signal)
        }))
    );

    /**
     * Download a case attachment from Directus as the user, stage into local Full Slicer, open.
     */
    app.post(
        '/api/directus/cases/:caseId/attachments/:attachmentId/open-local-full-slicer',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const caseId = String(req.params.caseId || '').trim();
            const attachmentId = String(req.params.attachmentId || '').trim();
            if (!caseId || !attachmentId) {
                throw new ValidationError(msg('case.case_and_file_required'), null, 'case.case_and_file_required');
            }

            const attachment = await getCaseAttachment(caseId, attachmentId, {
                accessToken: req.directusAccessToken
            });
            if (!canOpenAttachmentInSlicer(attachment)) {
                throw new ValidationError(
                    msg('viewer.file_type_unsupported'),
                    null,
                    'viewer.file_type_unsupported'
                );
            }

            const cachePromise = ensureDirectusAssetCached({
                fileId: attachment.fileId,
                filenameDownload: attachment.filenameDownload || attachment.name || 'attachment.bin',
                expectedSize: attachment.filesize,
                accessToken: req.directusAccessToken
            });
            const seatPromise = ensureLocalFullSlicerSeat(req, {
                failureMessage: "Couldn't start the viewer. Please try again in a moment.",
                requireSlicerUiReady: false
            });

            const [cached, seat] = await Promise.all([cachePromise, seatPromise]);
            const { launcherUserId, useSimplifiedViewer, session } = seat;
            const seatId = session.seatId;

            console.log('Staging Directus attachment into Full Slicer seat', {
                caseId,
                attachmentId,
                fileName: cached.fileName,
                bytes: cached.bytes,
                cached: cached.reused,
                seatId,
                useSimplifiedViewer
            });

            const stagedKey = `dx-${attachment.fileId}`;
            const staged = await stageCachedFileForSlicerGui({
                sourcePath: cached.cachePath,
                stagedKey,
                fileName: cached.fileName,
                launcherUserId,
                useSimplifiedViewer,
                seatId
            });

            const viewerPath = buildSlicerGuiViewerPath(launcherUserId, seatId);
            const frontendUrl = buildViewerFrontendUrl(req, launcherUserId, null, null);
            const origin = frontendUrl ? new URL(frontendUrl).origin : `${req.protocol}://${req.get('host')}`;
            const slicerGuiUrl = `${origin}${viewerPath.startsWith('/') ? viewerPath : `/${viewerPath}`}`;

            res.json({
                slicerGuiUrl,
                vncPath: viewerPath,
                sessionId: session.containerName,
                sessionToken: session.sessionToken,
                seatId,
                maxSeats: session.maxSeats,
                userId: launcherUserId,
                fileName: staged.fileName,
                containerPath: staged.containerPath || null,
                useSimplifiedViewer,
                sessionReused: session.reused === true,
                sceneReloaded: true,
                cached: cached.reused === true,
                attachmentId: attachment.id,
                caseId,
                stagedKey,
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
                warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI)
            });
        })
    );

    app.get('/api/directus/full-slicer-status', authenticateToken, asyncHandler(async (req, res) => {
        const seatId = parseOptionalSeatId(req.query?.seatId) || 1;
        const status = readSlicerGuiBusyStatus(String(req.user.id), seatId);
        res.json(status);
    }));

    app.post('/api/directus/full-slicer-heartbeat', authenticateToken, asyncHandler(async (req, res) => {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError(msg('viewer.session_token_missing'), null, 'viewer.session_token_missing');
        }

        const userId = String(req.user.id);
        const lease = touchSlicerGuiSessionHeartbeat({
            userId,
            sessionToken,
            seatId: parseOptionalSeatId(req.body?.seatId)
        });
        if (!lease) {
            return res.status(404).json({
                error: { message: msg('viewer.session_ended') }
            });
        }

        res.json({
            success: true,
            seatId: lease.metadata?.seatId ?? null,
            leaseExpiresAt: new Date(lease.leaseExpiresAt).toISOString(),
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI)
        });
    }));

    app.post('/api/directus/full-slicer-stop', authenticateToken, asyncHandler(async (req, res) => {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError(msg('viewer.session_token_missing'), null, 'viewer.session_token_missing');
        }

        const mode = normalizeViewerReleaseMode(req.body?.mode, { supportsSoft: true });
        const result = await releaseSlicerGuiSession({
            userId: String(req.user.id),
            sessionToken,
            mode
        });

        res.json({
            success: true,
            ...result
        });
    }));

    /** Proxy a Directus user's avatar — authenticated collaborators fetch via their own Directus token. */
    app.get('/api/directus/users/:userId/avatar', authenticateToken, requireDirectusLink, requireDirectusUserToken, asyncHandler(async (req, res) => {
        const userId = String(req.params.userId || '').trim();
        if (!userId) return res.status(404).end();
        const directusUser = await findDirectusUserById(userId);
        if (!directusUser?.avatar) return res.status(404).end();
        const base = (config.directus?.url || '').trim().replace(/\/+$/, '');
        if (!base) return res.status(404).end();
        const assetRes = await fetch(`${base}/assets/${encodeURIComponent(directusUser.avatar)}`, {
            headers: { Authorization: `Bearer ${req.directusAccessToken}` }
        });
        if (!assetRes.ok) return res.status(404).end();
        const buffer = Buffer.from(await assetRes.arrayBuffer());
        res.setHeader('Content-Type', assetRes.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.send(buffer);
    }));
}
