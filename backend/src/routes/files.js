import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import File from '../models/File.js';
import Project from '../models/Project.js';
import ShareLink, { SHARE_VIEWER_KINDS } from '../models/ShareLink.js';
import db from '../db/database.js';
import config from '../config/index.js';
import objectStorage from '../storage/index.js';
import { buildViewerFrontendUrl, getClientFacingProtocol } from '../utils/viewerUrl.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import {
    ensureSlicerGuiSession,
    touchSlicerGuiSessionHeartbeat,
    releaseSlicerGuiSession
} from '../slicerGui/sessionManager.js';
import { stageProjectFileForSlicerGui } from '../slicerGui/stageFile.js';
import {
    buildSlicerGuiViewerPath,
    writeLastLoadedFile
} from '../slicerGui/paths.js';
import {
    getSessionTtlSeconds,
    getWarmIdleTtlSeconds,
    SESSION_KINDS
} from '../sessions/index.js';
import { normalizeViewerReleaseMode } from '../sessions/config.js';
import { patchSessionMetadata } from '../sessions/leaseRegistry.js';
import { msg } from '../i18n/index.js';

const TRAME_SERVICE_URL = process.env.TRAME_SERVICE_URL || 'http://localhost:8090';

// Use memory storage - we'll save to disk ourselves after auth
const uploadStorage = multer.memoryStorage();

// Configure multer — no file-type filter; Slicer decides what it can handle
const upload = multer({
    storage: uploadStorage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB max file size (for medical imaging files)
    }
});

function getProjectRoleForFile(file, userId) {
    const projectId = Number(file?.project_id);
    if (!Number.isInteger(projectId) || projectId <= 0) return null;
    const project = Project.findForUser({ projectId, userId });
    return project?.userRole || null;
}

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (_) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }

        req.end();
    });
}

async function httpRequestWithRetry(url, options = {}, retries = 1, retryDelayMs = 300) {
    try {
        return await httpRequest(url, options);
    } catch (err) {
        const message = String(err?.message || '').toLowerCase();
        const isTransient =
            message.includes('socket hang up')
            || message.includes('econnreset')
            || message.includes('etimedout')
            || message.includes('eai_again');
        if (!isTransient || retries <= 0) {
            throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return httpRequestWithRetry(url, options, retries - 1, retryDelayMs);
    }
}

function parseAllowedUserIds(rawValue) {
    if (!Array.isArray(rawValue)) return [];
    const unique = new Set();
    rawValue.forEach((value) => {
        const id = Number(value);
        if (Number.isInteger(id) && id > 0) unique.add(id);
    });
    return [...unique];
}

function parseShareMode(rawValue) {
    return rawValue === 'current_view' ? 'current_view' : 'whole_file';
}

function parseViewerKind(rawValue) {
    return rawValue === SHARE_VIEWER_KINDS.SLICER_GUI
        ? SHARE_VIEWER_KINDS.SLICER_GUI
        : SHARE_VIEWER_KINDS.TRAME;
}

function isMrbFileName(name) {
    return String(name || '').toLowerCase().endsWith('.mrb');
}

function publicShareFilePayload(file) {
    const originalName = file.original_name || 'Shared file';
    const displayTitle = String(file.display_title || '').trim() || null;
    return {
        id: file.id,
        originalName,
        displayTitle,
        // Convenience label for share chrome (prefer scene title for MRBs).
        title: displayTitle || originalName
    };
}

async function resolveShareLinkOrThrow(token) {
    const share = ShareLink.findByToken(token);
    if (!share || ShareLink.isExpired(share)) {
        throw new NotFoundError(msg('share.invalid_or_expired'), null, 'share.invalid_or_expired');
    }
    return share;
}

async function authorizeShareAccess(req, share) {
    const requester = getOptionalAuthenticatedUser(req);
    const allowedUserIds = ShareLink.getAllowedUserIds(share);
    if (allowedUserIds.length > 0) {
        if (!requester) {
            throw new ForbiddenError(msg('share.sign_in_required'), null, 'share.sign_in_required');
        }
        if (!allowedUserIds.includes(Number(requester.id))) {
            throw new ForbiddenError(msg('share.not_permitted'), null, 'share.not_permitted');
        }
    }
    return requester;
}

const createShareLinkRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    message: msg('share.create_rate_limit'),
    getKey: (req) => `share-create:user:${req.user?.id || 'unknown'}`
});

const launchShareLinkPerIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: msg('share.launch_ip_rate_limit'),
    getKey: (req) => `share-launch:ip:${getRateLimitClientIp(req)}`
});

const launchShareLinkPerTokenAndIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 15,
    message: msg('share.launch_token_rate_limit'),
    getKey: (req) => `share-launch:token:${req.params.token || 'unknown'}:ip:${getRateLimitClientIp(req)}`
});

const replayShareLinkPerTokenAndIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: msg('share.replay_rate_limit'),
    getKey: (req) => `share-replay:token:${req.params.token || 'unknown'}:ip:${getRateLimitClientIp(req)}`
});

function getOptionalAuthenticatedUser(req) {
    try {
        const authHeader = req.headers.authorization;
        const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;
        if (!token) return null;
        const decoded = jwt.verify(token, config.jwt.secret);
        const session = db.prepare('SELECT id FROM sessions WHERE token_jti = ?').get(decoded.jti);
        if (!session) return null;
        return {
            id: decoded.userId,
            username: decoded.username,
            role: decoded.role
        };
    } catch (_) {
        return null;
    }
}

export default function fileRoutes(app) {
    /**
     * Upload a file
     */
    app.post('/api/files/upload', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
        if (!req.file) {
            throw new ValidationError(msg('file.no_upload'), null, 'file.no_upload');
        }

        let projectId = null;
        if (typeof req.body?.projectId !== 'undefined' && req.body.projectId !== '') {
            const parsedProjectId = Number(req.body.projectId);
            if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
                throw new ValidationError(msg('project.invalid_id'), null, 'project.invalid_id');
            }

            const project = Project.findForUser({ projectId: parsedProjectId, userId: req.user.id });
            if (!project) {
                throw new ValidationError(msg('project.not_found_or_inaccessible'), null, 'project.not_found_or_inaccessible');
            }
            if (project.userRole !== 'admin' && project.userRole !== 'collaborator') {
                throw new ForbiddenError(msg('file.project_upload_forbidden'), null, 'file.project_upload_forbidden');
            }

            projectId = parsedProjectId;
        }

        objectStorage.ensureUserDir(req.user.id);

        const sanitized = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueName = `${uuidv4()}-${sanitized}`;
        const filePath = objectStorage.relativeDbPathForUser(req.user.id, uniqueName);

        await objectStorage.write({
            key: filePath,
            buffer: req.file.buffer,
            contentType: req.file.mimetype
        });

        const fileRecord = File.create({
            userId: req.user.id,
            projectId,
            originalName: req.file.originalname,
            storedName: uniqueName,
            filePath,
            fileSize: req.file.size,
            mimeType: req.file.mimetype
        });

        const createdRow = File.findById(fileRecord.id);
        res.status(201).json({
            message: 'File uploaded successfully',
            file: {
                id: fileRecord.id,
                originalName: fileRecord.originalName,
                size: fileRecord.fileSize,
                mimeType: fileRecord.mimeType,
                uploadDate: createdRow?.upload_date || fileRecord.uploadDate,
                lastModifiedAt: createdRow?.last_modified_at || createdRow?.upload_date || fileRecord.uploadDate,
                lastViewedAt: createdRow?.last_viewed_at || null
            }
        });
    }));

    /**
     * Get list of user's files
     */
    app.get('/api/files', authenticateToken, asyncHandler(async (req, res) => {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit), 10) || 20, 1), 100);
        const offset = Math.max(parseInt(String(req.query.offset), 10) || 0, 0);
        const search = typeof req.query.search === 'string' ? req.query.search : '';
        const rawSortBy = req.query.sortBy;
        const sortBy = rawSortBy === 'name' ? 'name' : rawSortBy === 'viewed' ? 'viewed' : 'date';
        const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

        const { files, total } = File.listForUser(req.user.id, {
            limit,
            offset,
            search,
            sortBy,
            sortDir
        });

        const formattedFiles = files.map((file) => ({
            id: file.id,
            originalName: file.original_name,
            storedName: file.stored_name,
            size: file.file_size,
            mimeType: file.mime_type,
            uploadDate: file.upload_date,
            lastModifiedAt: file.last_modified_at || file.upload_date,
            lastViewedAt: file.last_viewed_at || null
        }));

        res.json({
            files: formattedFiles,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + formattedFiles.length < total
            }
        });
    }));

    /**
     * Download a file
     */
    app.get('/api/files/:id', authenticateToken, asyncHandler(async (req, res) => {
        const fileId = parseInt(req.params.id);

        // Get file metadata
        const file = File.findById(fileId);

        if (!file) {
            throw new NotFoundError(msg('file.not_found'), null, 'file.not_found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canAccess = isOwner || projectRole === 'admin' || projectRole === 'collaborator' || projectRole === 'observer';

        if (!canAccess) {
            throw new ForbiddenError(msg('file.access_forbidden'), null, 'file.access_forbidden');
        }

        const objectKey = objectStorage.normalizeKey(file.file_path);
        if (!(await objectStorage.exists(objectKey))) {
            throw new NotFoundError(msg('file.not_in_storage'), null, 'file.not_in_storage');
        }

        res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
        const stream = await objectStorage.openReadStream(objectKey);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.status(500).json({ error: { message: msg('file.read_failed') } });
            }
        });
        stream.pipe(res);
    }));

    /**
     * Delete a file
     */
    app.delete('/api/files/:id', authenticateToken, asyncHandler(async (req, res) => {
        const fileId = parseInt(req.params.id);

        // Get file metadata
        const file = File.findById(fileId);

        if (!file) {
            throw new NotFoundError(msg('file.not_found'), null, 'file.not_found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canDelete = isOwner || projectRole === 'admin' || projectRole === 'collaborator';

        if (!canDelete) {
            throw new ForbiddenError(msg('file.delete_forbidden'), null, 'file.delete_forbidden');
        }

        const objectKey = objectStorage.normalizeKey(file.file_path);
        if (await objectStorage.exists(objectKey)) {
            await objectStorage.delete(objectKey);
        }

        // Delete from database
        File.delete(fileId);

        res.json({ message: 'File deleted successfully' });
    }));

    /**
     * Create a share link for a file
     */
    app.post('/api/files/:id/share-links', authenticateToken, createShareLinkRateLimit, asyncHandler(async (req, res) => {
        const fileId = parseInt(req.params.id, 10);
        const file = File.findById(fileId);
        if (!file) {
            throw new NotFoundError(msg('file.not_found'), null, 'file.not_found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canShare = isOwner || projectRole === 'admin' || projectRole === 'collaborator';
        if (!canShare) {
            throw new ForbiddenError(msg('file.share_forbidden'), null, 'file.share_forbidden');
        }

        const expiresInHours = Number(req.body?.expiresInHours);
        if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 30) {
            throw new ValidationError(msg('share.expires_invalid'), null, 'share.expires_invalid');
        }
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
        const allowedUserIds = parseAllowedUserIds(req.body?.allowedUserIds);
        const viewerKind = parseViewerKind(req.body?.viewerKind);
        let shareMode = parseShareMode(req.body?.shareMode);
        const viewState = req.body?.viewState && typeof req.body.viewState === 'object'
            ? req.body.viewState
            : null;

        // Project Simplified Viewer shares: whole file only for this pass.
        if (viewerKind === SHARE_VIEWER_KINDS.SLICER_GUI) {
            shareMode = 'whole_file';
            if (!isMrbFileName(file.original_name)) {
                throw new ValidationError(msg('share.simplified_viewer_mrb_only'), null, 'share.simplified_viewer_mrb_only');
            }
        }
        if (shareMode === 'current_view' && !viewState) {
            throw new ValidationError(msg('share.view_state_required'), null, 'share.view_state_required');
        }

        const share = ShareLink.create({
            fileId,
            createdByUserId: req.user.id,
            readOnly: true,
            expiresAt,
            allowedUserIds,
            shareMode,
            viewState: shareMode === 'current_view' ? viewState : null,
            viewerKind
        });

        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
        const protocol = getClientFacingProtocol(req);
        const shareUrl = `${protocol}://${host}/?share=${encodeURIComponent(share.token)}`;

        res.status(201).json({
            message: 'Share link created',
            shareLink: {
                token: share.token,
                url: shareUrl,
                expiresAt: share.expiresAt,
                readOnly: true,
                allowedUserIds: share.allowedUserIds,
                shareMode: share.shareMode,
                viewerKind: share.viewerKind
            }
        });
    }));

    /**
     * Launch read-only session from a share token (Trame or Simplified Viewer).
     */
    app.get(
        '/api/share-links/:token/launch',
        launchShareLinkPerIpRateLimit,
        launchShareLinkPerTokenAndIpRateLimit,
        asyncHandler(async (req, res) => {
        const token = (req.params.token || '').trim();
        if (!token) {
            throw new ValidationError(msg('share.token_required'), null, 'share.token_required');
        }

        const share = await resolveShareLinkOrThrow(token);
        await authorizeShareAccess(req, share);
        const viewState = ShareLink.getViewState(share);
        const viewerKind = ShareLink.getViewerKind(share);

        const file = File.findById(Number(share.file_id));
        if (!file) {
            throw new NotFoundError(msg('share.file_gone'), null, 'share.file_gone');
        }
        const objectKey = objectStorage.normalizeKey(file.file_path);
        if (!(await objectStorage.exists(objectKey))) {
            throw new NotFoundError(msg('share.file_not_in_storage'), null, 'share.file_not_in_storage');
        }

        const sessionUserId = `share-${share.id}`;

        // --- Simplified Viewer (Full Slicer seat, developer mode) ---
        if (viewerKind === SHARE_VIEWER_KINDS.SLICER_GUI) {
            const useSimplifiedViewer = true;
            let session;
            try {
                session = await ensureSlicerGuiSession({
                    userId: sessionUserId,
                    seatId: 1,
                    preferFileId: file.id,
                    useSimplifiedViewer,
                    requireSlicerUiReady: true
                });
            } catch (err) {
                throw new ValidationError(
                    err.message || msg('share.simplified_viewer_start_failed')
                );
            }
            const seatId = session.seatId || 1;
            const sameFileAlreadyLoaded = session.reused === true
                && session.sceneLoaded === true
                && Number(session.lastLoadedFileId) === file.id;

            let staged;
            let sceneReloaded = true;
            if (sameFileAlreadyLoaded) {
                sceneReloaded = false;
                staged = {
                    fileName: file.original_name,
                    useSimplifiedViewer: true,
                    skipped: true
                };
            } else {
                staged = await stageProjectFileForSlicerGui({
                    file,
                    launcherUserId: sessionUserId,
                    useSimplifiedViewer: true,
                    seatId
                });
                patchSessionMetadata(SESSION_KINDS.SLICER_GUI, session.sessionKey, {
                    lastLoadedFileId: file.id,
                    lastLoadedFileName: staged.fileName,
                    sceneLoaded: false
                });
                writeLastLoadedFile(sessionUserId, {
                    fileId: file.id,
                    fileName: staged.fileName,
                    useSimplifiedViewer: true,
                    sceneLoaded: false,
                    seatId
                });
            }

            File.touchLastViewed(file.id);
            const viewerPath = buildSlicerGuiViewerPath(sessionUserId, seatId);
            return res.json({
                viewerKind: SHARE_VIEWER_KINDS.SLICER_GUI,
                vncPath: viewerPath,
                sessionToken: session.sessionToken,
                seatId,
                useSimplifiedViewer: true,
                sessionReused: session.reused === true,
                sceneReloaded,
                file: publicShareFilePayload(file),
                readOnly: true,
                shareMode: 'whole_file',
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
                warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI)
            });
        }

        // --- Trame (My Files default) ---
        objectStorage.ensureUserDir(sessionUserId);
        const sharedName = `shared-${file.id}-${path.basename(objectKey)}`;
        await objectStorage.ensureStagedCopy({
            sourceKey: objectKey,
            userId: sessionUserId,
            fileName: sharedName
        });

        const sessionData = await httpRequestWithRetry(`${TRAME_SERVICE_URL}/api/sessions/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                userId: sessionUserId,
                filePath: sharedName,
                readOnly: true,
                viewState: viewState || null,
            }
        }, 2, 500);

        const frontendUrl = buildViewerFrontendUrl(req, sessionData.userId, sessionData.port);
        File.touchLastViewed(file.id);

        res.json({
            viewerKind: SHARE_VIEWER_KINDS.TRAME,
            frontendUrl,
            file: publicShareFilePayload(file),
            readOnly: true,
            shareMode: share.share_mode || 'whole_file',
            viewStateApplied: !viewState,
            viewStateApplyError: null,
            viewStateApplyDebug: null
        });
        })
    );

    app.post('/api/share-links/:token/full-slicer-heartbeat',
        launchShareLinkPerIpRateLimit,
        asyncHandler(async (req, res) => {
            const token = (req.params.token || '').trim();
            const share = await resolveShareLinkOrThrow(token);
            await authorizeShareAccess(req, share);
            if (ShareLink.getViewerKind(share) !== SHARE_VIEWER_KINDS.SLICER_GUI) {
                throw new ValidationError(msg('share.not_simplified_viewer'), null, 'share.not_simplified_viewer');
            }

            const sessionToken = String(req.body?.sessionToken || '').trim();
            if (!sessionToken) {
                throw new ValidationError(msg('session.token_required'), null, 'session.token_required');
            }

            const lease = touchSlicerGuiSessionHeartbeat({
                userId: `share-${share.id}`,
                sessionToken,
                seatId: Number(req.body?.seatId) || 1
            });
            if (!lease) {
                return res.status(404).json({
                    error: { message: msg('slicer_gui.session_not_found') }
                });
            }

            res.json({
                success: true,
                seatId: lease.metadata?.seatId ?? 1,
                leaseExpiresAt: new Date(lease.leaseExpiresAt).toISOString(),
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI)
            });
        }));

    app.post('/api/share-links/:token/full-slicer-stop',
        launchShareLinkPerIpRateLimit,
        asyncHandler(async (req, res) => {
            const token = (req.params.token || '').trim();
            const share = await resolveShareLinkOrThrow(token);
            await authorizeShareAccess(req, share);
            if (ShareLink.getViewerKind(share) !== SHARE_VIEWER_KINDS.SLICER_GUI) {
                throw new ValidationError(msg('share.not_simplified_viewer'), null, 'share.not_simplified_viewer');
            }

            const sessionToken = String(req.body?.sessionToken || '').trim();
            if (!sessionToken) {
                throw new ValidationError(msg('session.token_required'), null, 'session.token_required');
            }

            const mode = normalizeViewerReleaseMode(req.body?.mode, { supportsSoft: true });
            const result = await releaseSlicerGuiSession({
                userId: `share-${share.id}`,
                sessionToken,
                seatId: Number(req.body?.seatId) || 1,
                mode
            });

            res.json({
                success: true,
                ...result
            });
        }));

    /**
     * Re-apply shared view state after viewer iframe is loaded.
     * This helps when scene initialization overrides early replay.
     */
    app.post('/api/share-links/:token/replay-view-state',
        replayShareLinkPerTokenAndIpRateLimit,
        asyncHandler(async (req, res) => {
        const token = (req.params.token || '').trim();
        if (!token) {
            throw new ValidationError(msg('share.token_required'), null, 'share.token_required');
        }

        const share = ShareLink.findByToken(token);
        if (!share || ShareLink.isExpired(share)) {
            throw new NotFoundError(msg('share.invalid_or_expired'), null, 'share.invalid_or_expired');
        }
        if (ShareLink.getViewerKind(share) === SHARE_VIEWER_KINDS.SLICER_GUI) {
            return res.json({ applied: true, skipped: true, reason: 'slicer_gui_no_view_state' });
        }

        const viewState = ShareLink.getViewState(share);
        if (!viewState) {
            return res.json({ applied: true, skipped: true, reason: 'no_view_state' });
        }

        const sessionUserId = `share-${share.id}`;
        const sessions = await httpRequestWithRetry(`${TRAME_SERVICE_URL}/api/sessions`, { method: 'GET' }, 2, 400);
        const targetSession = sessions.sessions?.find((s) => String(s.userId) === sessionUserId);
        if (!targetSession?.sessionId) {
            return res.status(404).json({ applied: false, reason: 'share_session_not_found' });
        }

        const applyResult = await httpRequestWithRetry(
            `${TRAME_SERVICE_URL}/api/sessions/${targetSession.sessionId}/apply-view-state`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { viewState }
            },
            1,
            350
        );

        const applied = applyResult?.status === 'applied';
        return res.json({
            applied,
            sessionId: targetSession.sessionId,
            error: applied ? null : (applyResult?.error || 'View-state replay did not fully apply'),
            debug: applyResult?.debug || null
        });
    }));

    /**
     * Get user storage statistics
     */
    app.get('/api/files/stats/storage', authenticateToken, asyncHandler(async (req, res) => {
        const bytesUsed = File.getUserStorageUsed(req.user.id);
        const files = File.findByUserId(req.user.id);

        res.json({
            bytesUsed,
            megabytesUsed: (bytesUsed / (1024 * 1024)).toFixed(2),
            fileCount: files.length
        });
    }));
}
