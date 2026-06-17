import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import File from '../models/File.js';
import Project from '../models/Project.js';
import ShareLink from '../models/ShareLink.js';
import db from '../db/database.js';
import config from '../config/index.js';
import objectStorage from '../storage/index.js';
import { buildViewerFrontendUrl, getClientFacingProtocol } from '../utils/viewerUrl.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';

const TRAME_SERVICE_URL = process.env.TRAME_SERVICE_URL || 'http://localhost:8090';

// Use memory storage - we'll save to disk ourselves after auth
const uploadStorage = multer.memoryStorage();

// File filter - validate file types
const fileFilter = (req, file, cb) => {
    // Allow common file types plus medical imaging formats
    const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/json',
        'application/zip',
        'application/x-zip-compressed',
        // Medical imaging formats
        'application/dicom',           // DICOM files (.dcm)
        'application/x-nrrd',          // NRRD files (.nrrd)
        'application/x-mrb',           // MRB files (.mrb - 3D Slicer Medical Reality Bundle)
        'application/octet-stream'     // Generic binary (fallback for .nrrd, .dcm, .mrb when browser can't identify)
    ];
    
    // Also check file extension for MRB files (3D Slicer Medical Reality Bundle)
    // Browsers may report .mrb files with various MIME types
    const fileName = file.originalname.toLowerCase();
    const isMRBFile = fileName.endsWith('.mrb');

    if (allowedMimes.includes(file.mimetype) || isMRBFile) {
        cb(null, true);
    } else {
        cb(new ValidationError(`File type ${file.mimetype} is not allowed`), false);
    }
};

// Configure multer
const upload = multer({
    storage: uploadStorage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max file size (for medical imaging files)
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

const createShareLinkRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too many share-link creation requests. Please wait and try again.',
    getKey: (req) => `share-create:user:${req.user?.id || 'unknown'}`
});

const launchShareLinkPerIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Too many shared-link launch attempts from this IP. Please try again shortly.',
    getKey: (req) => `share-launch:ip:${getRateLimitClientIp(req)}`
});

const launchShareLinkPerTokenAndIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 15,
    message: 'This shared link is being opened too frequently. Please wait and try again.',
    getKey: (req) => `share-launch:token:${req.params.token || 'unknown'}:ip:${getRateLimitClientIp(req)}`
});

const replayShareLinkPerTokenAndIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many view-state replay requests for this link. Please wait and try again.',
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
            throw new ValidationError('No file uploaded');
        }

        let projectId = null;
        if (typeof req.body?.projectId !== 'undefined' && req.body.projectId !== '') {
            const parsedProjectId = Number(req.body.projectId);
            if (!Number.isInteger(parsedProjectId) || parsedProjectId <= 0) {
                throw new ValidationError('Invalid project id');
            }

            const project = Project.findForUser({ projectId: parsedProjectId, userId: req.user.id });
            if (!project) {
                throw new ValidationError('Project not found or inaccessible');
            }
            if (project.userRole !== 'admin' && project.userRole !== 'collaborator') {
                throw new ForbiddenError('Only admins and collaborators can add files to this project');
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
            throw new NotFoundError('File not found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canAccess = isOwner || projectRole === 'admin' || projectRole === 'collaborator' || projectRole === 'observer';

        if (!canAccess) {
            throw new ForbiddenError('You do not have permission to access this file');
        }

        const objectKey = objectStorage.normalizeKey(file.file_path);
        if (!(await objectStorage.exists(objectKey))) {
            throw new NotFoundError('File not found in storage');
        }

        res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
        const stream = await objectStorage.openReadStream(objectKey);
        stream.on('error', () => {
            if (!res.headersSent) {
                res.status(500).json({ error: { message: 'Failed to read file' } });
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
            throw new NotFoundError('File not found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canDelete = isOwner || projectRole === 'admin' || projectRole === 'collaborator';

        if (!canDelete) {
            throw new ForbiddenError('You do not have permission to delete this file');
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
            throw new NotFoundError('File not found');
        }

        const isOwner = File.isOwner(fileId, req.user.id);
        const projectRole = getProjectRoleForFile(file, req.user.id);
        const canShare = isOwner || projectRole === 'admin' || projectRole === 'collaborator';
        if (!canShare) {
            throw new ForbiddenError('You do not have permission to share this file');
        }

        const expiresInHours = Number(req.body?.expiresInHours);
        if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 24 * 30) {
            throw new ValidationError('expiresInHours must be between 1 and 720');
        }
        const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
        const allowedUserIds = parseAllowedUserIds(req.body?.allowedUserIds);
        const shareMode = parseShareMode(req.body?.shareMode);
        const viewState = req.body?.viewState && typeof req.body.viewState === 'object'
            ? req.body.viewState
            : null;
        if (shareMode === 'current_view' && !viewState) {
            throw new ValidationError('viewState is required when shareMode is current_view');
        }

        const share = ShareLink.create({
            fileId,
            createdByUserId: req.user.id,
            readOnly: true,
            expiresAt,
            allowedUserIds,
            shareMode,
            viewState
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
                shareMode: share.shareMode
            }
        });
    }));

    /**
     * Launch read-only session from a share token
     */
    app.get(
        '/api/share-links/:token/launch',
        launchShareLinkPerIpRateLimit,
        launchShareLinkPerTokenAndIpRateLimit,
        asyncHandler(async (req, res) => {
        const token = (req.params.token || '').trim();
        if (!token) {
            throw new ValidationError('Share token is required');
        }

        const share = ShareLink.findByToken(token);
        if (!share || ShareLink.isExpired(share)) {
            throw new NotFoundError('Share link is invalid or expired');
        }
        const requester = getOptionalAuthenticatedUser(req);
        const allowedUserIds = ShareLink.getAllowedUserIds(share);
        const viewState = ShareLink.getViewState(share);
        if (allowedUserIds.length > 0) {
            if (!requester) {
                throw new ForbiddenError('This shared file requires sign in');
            }
            if (!allowedUserIds.includes(Number(requester.id))) {
                throw new ForbiddenError('You are not permitted to open this shared file');
            }
        }

        const file = File.findById(Number(share.file_id));
        if (!file) {
            throw new NotFoundError('Shared file no longer exists');
        }
        const objectKey = objectStorage.normalizeKey(file.file_path);
        if (!(await objectStorage.exists(objectKey))) {
            throw new NotFoundError('Shared file not found in storage');
        }

        const sessionUserId = `share-${share.id}`;
        objectStorage.ensureUserDir(sessionUserId);
        const sharedName = `shared-${file.id}-${path.basename(objectKey)}`;
        await objectStorage.ensureStagedCopy({
            sourceKey: objectKey,
            userId: sessionUserId,
            fileName: sharedName
        });

        let sessionData = null;
        let viewStateApplied = false;
        let viewStateApplyError = null;
        let viewStateApplyDebug = null;

        // Start session first; this is required and should fail request if unavailable.
        sessionData = await httpRequestWithRetry(`${TRAME_SERVICE_URL}/api/sessions/start`, {
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

        // Replay is applied later from the shared viewer after iframe load.
        viewStateApplied = !viewState;
        viewStateApplyError = null;
        viewStateApplyDebug = null;

        const frontendUrl = buildViewerFrontendUrl(req, sessionData.userId, sessionData.port);

        File.touchLastViewed(file.id);

        res.json({
            frontendUrl,
            file: {
                id: file.id,
                originalName: file.original_name
            },
            readOnly: true,
            shareMode: share.share_mode || 'whole_file',
            viewStateApplied,
            viewStateApplyError,
            viewStateApplyDebug
        });
        })
    );

    /**
     * Re-apply shared view state after viewer iframe is loaded.
     * This helps when scene initialization overrides early replay.
     */
    app.post('/api/share-links/:token/replay-view-state',
        replayShareLinkPerTokenAndIpRateLimit,
        asyncHandler(async (req, res) => {
        const token = (req.params.token || '').trim();
        if (!token) {
            throw new ValidationError('Share token is required');
        }

        const share = ShareLink.findByToken(token);
        if (!share || ShareLink.isExpired(share)) {
            throw new NotFoundError('Share link is invalid or expired');
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
