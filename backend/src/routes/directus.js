import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import config from '../config/index.js';
import db from '../db/database.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import multer from 'multer';
import {
    listCases,
    isDirectusUrlConfigured,
    getCaseAttachment,
    ensureDirectusAssetCached,
    canOpenAttachmentInSlicer,
    createCaseComment,
    createCase,
    updateCase,
    uploadDirectusFile,
    createCaseAttachment,
    deleteCaseAttachment,
    fetchDirectusViewer,
    lookupDirectusUserByEmail,
    setCaseCollaborators
} from '../services/directus.js';
import {
    inviteExistingUserToCase,
    listPendingInvitesForCase,
    approveCaseInvite,
    rejectCaseInvite
} from '../services/caseInvites.js';
import {
    listSignupInvitesForCase,
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
    unreadNotificationCount
} from '../services/notifications.js';

// 500 MB cap — large MRB / imaging files are expected. Adjust via env if needed.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES) || 500 * 1024 * 1024 }
});
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
        throw new ValidationError(failureMessage || "Couldn't start the viewer. Please try again in a moment.");
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
            if (!caseId) throw new ValidationError('Case is required.');

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
        if (!caseId) throw new ValidationError('Case is required.');
        const email = String(req.body?.email || '').trim();
        if (!email) throw new ValidationError('Email is required.');

        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError('Could not confirm your account for this session. Please sign in again.');
        }

        const result = await inviteExistingUserToCase({
            caseId,
            email,
            role: req.body?.role || 'collaborator',
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId),
            actorAppUserId: req.user?.id
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

    /** Pending invites for a case (existing users + signup emails). */
    app.get('/api/directus/cases/:caseId/invites', ...collabAuth, asyncHandler(async (req, res) => {
        const caseId = String(req.params.caseId || '').trim();
        if (!caseId) throw new ValidationError('Case is required.');
        const invites = [
            ...listPendingInvitesForCase(caseId),
            ...listSignupInvitesForCase(caseId)
        ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        res.set('Cache-Control', 'no-store');
        res.json({ invites });
    }));

    app.post('/api/directus/cases/:caseId/invites/:inviteId/approve', ...collabAuth, asyncHandler(async (req, res) => {
        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError('Could not confirm your account for this session. Please sign in again.');
        }
        const caseId = String(req.params.caseId || '').trim();
        const inviteId = req.params.inviteId;
        const kindHint = String(req.body?.kind || req.query?.kind || '').trim().toLowerCase();
        const args = {
            inviteId,
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        };

        // Resolve table by hint, then fall back — signup and existing invite ids can collide.
        const trySignup = () => {
            const row = db.prepare(
                'SELECT id, case_id, status FROM case_signup_invites WHERE id = ?'
            ).get(Number(inviteId));
            if (
                row
                && String(row.case_id) === caseId
                && row.status === 'pending_approval'
            ) {
                return approveSignupInvite(args);
            }
            return null;
        };
        const tryExisting = () => {
            const row = db.prepare(
                'SELECT id, case_id, status FROM case_invites WHERE id = ?'
            ).get(Number(inviteId));
            if (row && String(row.case_id) === caseId && row.status === 'pending') {
                return approveCaseInvite(args);
            }
            return null;
        };

        let result = null;
        if (kindHint === 'signup') {
            result = await trySignup();
            if (!result) result = await tryExisting();
        } else {
            result = await tryExisting();
            if (!result) result = await trySignup();
        }
        if (!result) {
            throw new NotFoundError('Pending invite not found');
        }
        res.json(result);
    }));

    app.post('/api/directus/cases/:caseId/invites/:inviteId/reject', ...collabAuth, asyncHandler(async (req, res) => {
        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError('Could not confirm your account for this session. Please sign in again.');
        }
        const caseId = String(req.params.caseId || '').trim();
        const inviteId = req.params.inviteId;
        const kindHint = String(req.body?.kind || req.query?.kind || '').trim().toLowerCase();
        const args = {
            inviteId,
            accessToken: req.directusAccessToken,
            actorDirectusUserId: String(actorDirectusUserId)
        };

        const trySignup = () => {
            const row = db.prepare(
                'SELECT id, case_id, status FROM case_signup_invites WHERE id = ?'
            ).get(Number(inviteId));
            if (
                row
                && String(row.case_id) === caseId
                && ['pending_approval', 'pending_signup'].includes(row.status)
            ) {
                return rejectSignupInvite(args);
            }
            return null;
        };
        const tryExisting = () => {
            const row = db.prepare(
                'SELECT id, case_id, status FROM case_invites WHERE id = ?'
            ).get(Number(inviteId));
            if (row && String(row.case_id) === caseId && row.status === 'pending') {
                return rejectCaseInvite(args);
            }
            return null;
        };

        let result = null;
        if (kindHint === 'signup') {
            result = await trySignup();
            if (!result) result = await tryExisting();
        } else {
            result = await tryExisting();
            if (!result) result = await trySignup();
        }
        if (!result) {
            throw new NotFoundError('Pending invite not found');
        }
        res.json(result);
    }));

    /** Public: preview a signup invite (no session). */
    app.get('/api/invites/signup/:token', asyncHandler(async (req, res) => {
        const preview = getSignupInvitePreview(req.params.token);
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
            if (!caseId) throw new ValidationError('Case is required.');

        const actorDirectusUserId = req.directusIdentity?.externalId
            || (await fetchDirectusViewer(req.directusAccessToken))?.id;
        if (!actorDirectusUserId) {
            throw new ValidationError('Could not confirm your account for this session. Please sign in again.');
        }

        const raw = req.body?.collaborators;
        if (!Array.isArray(raw)) {
            throw new ValidationError('People list is invalid. Please try again.');
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
     * Upload a file and attach it to a case.
     * Accepts multipart/form-data with a `file` field.
     * Optional body field: `name` (display name; defaults to original filename).
     */
    app.post(
        '/api/directus/cases/:caseId/attachments',
        ...collabAuth,
        upload.single('file'),
        asyncHandler(async (req, res) => {
            const caseId = String(req.params.caseId || '').trim();
            if (!caseId) throw new ValidationError('Case is required.');
            if (!req.file) throw new ValidationError('Please choose a file to upload.');

            const originalName = req.file.originalname || 'upload';
            const displayName = String(req.body?.name || '').trim() || originalName;

            // 1. Upload the file bytes to Directus /files (keep original filename)
            const directusFile = await uploadDirectusFile({
                buffer: req.file.buffer,
                originalname: originalName,
                mimetype: req.file.mimetype
            }, { accessToken: req.directusAccessToken });

            // 2. Create the attachment record linking Directus file → case
            const attachment = await createCaseAttachment(
                caseId,
                directusFile.id,
                displayName,
                { accessToken: req.directusAccessToken, fileMeta: directusFile }
            );

            res.status(201).json({
                attachment,
                meta: {
                    actingAs: 'user',
                    directusUserId: req.directusIdentity?.externalId || null,
                    directusFileId: directusFile.id,
                    bytes: req.file.size
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
                throw new ValidationError('Case and file are required.');
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
            accessToken: req.directusAccessToken
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
                throw new ValidationError('Case and file are required.');
            }

            const attachment = await getCaseAttachment(caseId, attachmentId, {
                accessToken: req.directusAccessToken
            });
            if (!canOpenAttachmentInSlicer(attachment)) {
                throw new ValidationError(
                    "This file type can't be opened in the viewer yet."
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
            throw new ValidationError('Viewer session is missing. Open the file again.');
        }

        const userId = String(req.user.id);
        const lease = touchSlicerGuiSessionHeartbeat({
            userId,
            sessionToken,
            seatId: parseOptionalSeatId(req.body?.seatId)
        });
        if (!lease) {
            return res.status(404).json({
                error: { message: 'The viewer session ended. Open the file again to continue.' }
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
            throw new ValidationError('Viewer session is missing. Open the file again.');
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
}
