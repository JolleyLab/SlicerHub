import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../utils/errors.js';
import config from '../config/index.js';
import User from '../models/User.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import {
    listCases,
    isDirectusUrlConfigured,
    getCaseAttachment,
    ensureDirectusAssetCached,
    isMrbAttachment,
    createCaseComment
} from '../services/directus.js';
import { stageCachedFileForSlicerGui } from '../slicerGui/stageFile.js';
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

function resolveUseSimplifiedViewer({ body, userId }) {
    if (body?.useSimplifiedViewer !== undefined) {
        return body.useSimplifiedViewer === true;
    }
    const accountPrefs = User.getPreferences(userId);
    return accountPrefs?.useSimplifiedViewer === true;
}

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
        throw new ValidationError(err.message || failureMessage);
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
        const cases = await listCases({
            limit: req.query.limit,
            accessToken: req.directusAccessToken
        });
        res.json({
            cases,
            meta: {
                configured: isDirectusUrlConfigured(),
                source: 'directus:case',
                actingAs: 'user',
                directusUserId: req.directusIdentity?.externalId || null
            }
        });
    }));

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
                throw new ValidationError('caseId and attachmentId are required');
            }

            const attachment = await getCaseAttachment(caseId, attachmentId, {
                accessToken: req.directusAccessToken
            });
            if (!isMrbAttachment(attachment)) {
                throw new ValidationError(
                    'Only MRB attachments can be opened in Full Slicer for this PoC'
                );
            }

            // PoC: always full UI. SimplifiedViewer selectModule re-entering Qt before
            // clear_request caused an infinite MRB reload loop (progress flicker).
            req.body = { ...(req.body || {}), useSimplifiedViewer: false };

            const cachePromise = ensureDirectusAssetCached({
                fileId: attachment.fileId,
                filenameDownload: attachment.filenameDownload || attachment.name || 'scene.mrb',
                expectedSize: attachment.filesize,
                accessToken: req.directusAccessToken
            });
            const seatPromise = ensureLocalFullSlicerSeat(req, {
                failureMessage: 'Unable to start local Full Slicer session. Is the slicer-gui image built?',
                requireSlicerUiReady: false
            });

            const [cached, seat] = await Promise.all([cachePromise, seatPromise]);
            const { launcherUserId, session } = seat;
            const seatId = session.seatId;
            const effectiveSimplified = false;

            console.log('Staging Directus MRB into Full Slicer seat', {
                caseId,
                attachmentId,
                fileName: cached.fileName,
                bytes: cached.bytes,
                cached: cached.reused,
                seatId,
                useSimplifiedViewer: effectiveSimplified
            });

            const stagedKey = `dx-${attachment.fileId}`;
            const staged = await stageCachedFileForSlicerGui({
                sourcePath: cached.cachePath,
                stagedKey,
                fileName: cached.fileName,
                launcherUserId,
                useSimplifiedViewer: effectiveSimplified,
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
                useSimplifiedViewer: false,
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

    app.post('/api/directus/full-slicer-heartbeat', authenticateToken, asyncHandler(async (req, res) => {
        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError('sessionToken is required');
        }

        const userId = String(req.user.id);
        const lease = touchSlicerGuiSessionHeartbeat({
            userId,
            sessionToken,
            seatId: parseOptionalSeatId(req.body?.seatId)
        });
        if (!lease) {
            return res.status(404).json({
                error: { message: 'Full Slicer session not found or expired' }
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
            throw new ValidationError('sessionToken is required');
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
