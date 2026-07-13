import { authenticateToken } from "../middleware/authMiddleware.js";
import File from "../models/File.js";
import Project from "../models/Project.js";
import ProjectGpu from "../models/ProjectGpu.js";
import path from "path";
import https from "https";
import http from "http";
import storage from "../storage/index.js";
import { buildViewerFrontendUrl } from "../utils/viewerUrl.js";
import { buildInternalViewerCheckUrl, waitForViewerReady, isLocalDockerSession } from "../utils/viewerReady.js";
import {
    getTrameContextForProject,
    syncProjectFile,
    touchProjectBillingActivity,
    assertProjectGpuReadyForFileOpen
} from "../gpu/orchestrator.js";
import { waitForPrestageIdle } from "../gpu/prestage.js";
import {
    resolveTrameServiceUrl,
    resolveLocalTrameServiceUrl,
    getUserTrameContext,
    setUserTrameContext
} from "../gpu/sessionContext.js";
import {
    registerViewerSession,
    touchViewerSession,
    releaseViewerSession,
    forceStopViewerSession,
    createSessionToken,
    getSessionTtlSeconds,
    SESSION_KINDS
} from "../sessions/index.js";

// Simple HTTP request helper
function fileRowToApiSnapshot(row) {
    if (!row) return null;
    return {
        id: row.id,
        originalName: row.original_name,
        size: row.file_size,
        mimeType: row.mime_type,
        uploadDate: row.upload_date,
        lastModifiedAt: row.last_modified_at || row.upload_date,
        lastViewedAt: row.last_viewed_at || null
    };
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
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
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

export default async function containerRoutes(app) {
    app.post("/api/containers/start", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        const { fileId, projectId: bodyProjectId } = req.body;

        try {
            let filePath = null;
            let viewedFileRecord = null;
            let projectId = Number(bodyProjectId) || null;
            let trameContext = null;

            if (fileId) {
                const file = File.findById(fileId);
                // Only use project GPU when the client passes projectId (project page launch).
                const projectRole = Number.isInteger(projectId) && projectId > 0
                    ? Project.findForUser({ projectId, userId: req.user.id })?.userRole
                    : null;
                const canAccess = !!file && (
                    file.user_id === req.user.id
                    || projectRole === 'admin'
                    || projectRole === 'collaborator'
                    || projectRole === 'observer'
                );

                if (canAccess) {
                    viewedFileRecord = file;

                    if (projectId) {
                        const gpuSettings = ProjectGpu.getSettings(projectId);
                        if (gpuSettings.providerId !== 'local') {
                            assertProjectGpuReadyForFileOpen({
                                projectId,
                                userId: req.user.id
                            });
                            trameContext = getTrameContextForProject(projectId);
                            await waitForPrestageIdle(projectId);
                            const syncStarted = Date.now();
                            await syncProjectFile({
                                projectId,
                                file,
                                launcherUserId: req.user.id
                            });
                            const syncSec = ((Date.now() - syncStarted) / 1000).toFixed(1);
                            console.log(`GPU sync on open project ${projectId} file ${fileId}: ${syncSec}s`);
                        }
                    }

                    if (file.user_id !== req.user.id) {
                        storage.ensureUserDir(userId);
                        const sharedName = `shared-${file.id}-${path.basename(file.file_path)}`;
                        if (await storage.exists(file.file_path)) {
                            await storage.ensureStagedCopy({
                                sourceKey: file.file_path,
                                userId,
                                fileName: sharedName
                            });
                            filePath = sharedName;
                        }
                    } else {
                        filePath = path.basename(file.file_path);
                    }
                }
            }

            const trameServiceUrl = trameContext?.trameServiceUrl || resolveLocalTrameServiceUrl();
            setUserTrameContext(userId, trameContext);
            if (trameContext?.projectId) {
                touchProjectBillingActivity(trameContext.projectId);
            }

            const startedAt = Date.now();
            const sessionData = await httpRequest(`${trameServiceUrl}/api/sessions/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: {
                    userId: userId,
                    filePath: filePath
                }
            });

            if (viewedFileRecord?.id) {
                File.touchLastViewed(viewedFileRecord.id);
            }

            // Return URL routed through nginx using userId so nginx can resolve the container by name
            const frontendUrl = buildViewerFrontendUrl(
                req,
                sessionData.userId,
                sessionData.port,
                trameContext
            );

            const viewerCheckUrl = buildInternalViewerCheckUrl(
                sessionData.userId,
                sessionData.port,
                trameContext
            );
            let viewerReady = true;
            if (!isLocalDockerSession(trameContext)) {
                viewerReady = await waitForViewerReady(viewerCheckUrl, {
                    maxWaitMs: trameContext ? 120000 : 15000,
                    intervalMs: 200
                });
            }

            console.log('Trame session started', {
                userId,
                projectId: trameContext?.projectId ?? null,
                sessionPort: sessionData.port,
                frontendUrl,
                trameServiceUrl,
                viewerReady,
                startMs: Date.now() - startedAt
            });

            const sessionToken = createSessionToken();
            registerViewerSession(SESSION_KINDS.TRAME, userId, {
                sessionToken,
                metadata: {
                    sessionId: sessionData.sessionId,
                    trameServiceUrl,
                    projectId: trameContext?.projectId ?? null
                }
            });

            res.json({
                sessionId: sessionData.sessionId,
                frontendUrl,
                gpuSync: trameContext ? 'remote' : 'local',
                viewerReady,
                sessionToken,
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.TRAME)
            });
        } catch (err) {
            console.error("Error starting trame session:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/containers/stop", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        const bodyProjectId = Number(req.body?.projectId) || null;
        const sessionToken = String(req.body?.sessionToken || '').trim();

        try {
            if (sessionToken) {
                const result = await releaseViewerSession(SESSION_KINDS.TRAME, userId, sessionToken);
                if (bodyProjectId) {
                    setUserTrameContext(userId, null);
                }
                return res.json({
                    success: true,
                    stopped: result.stopped,
                    projectId: bodyProjectId,
                    reason: result.reason || null,
                    message: result.stopped ? `Session for ${userId} stopped` : 'Stale viewer session'
                });
            }

            await forceStopViewerSession(SESSION_KINDS.TRAME, userId);
            res.json({
                success: true,
                stopped: true,
                projectId: bodyProjectId,
                message: `Session for ${userId} stopped`
            });
        } catch (err) {
            console.error("Error stopping trame session:", err);
            setUserTrameContext(userId, null);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/containers/save", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        const { saveMode = "overwrite", targetFileName, fileId } = req.body || {};

        try {
            const trameServiceUrl = resolveTrameServiceUrl(userId);
            const sessions = await httpRequest(`${trameServiceUrl}/api/sessions`);
            const userSession = sessions.sessions?.find(s => s.userId === userId);

            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }

            let normalizedName = path.basename(targetFileName || "last-saved-scene.mrb");
            let overwriteTargetRecord = null;

            if (saveMode === "overwrite") {
                if (!fileId) {
                    return res.status(400).json({ error: "fileId is required for overwrite saves" });
                }
                overwriteTargetRecord = File.findById(parseInt(fileId, 10));
                if (!overwriteTargetRecord || overwriteTargetRecord.user_id !== req.user.id) {
                    return res.status(404).json({ error: "Target file for overwrite not found" });
                }
                normalizedName = path.basename(overwriteTargetRecord.file_path || overwriteTargetRecord.stored_name);
            }
            const saveResult = await httpRequest(
                `${trameServiceUrl}/api/sessions/${userSession.sessionId}/save`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: { targetFileName: normalizedName }
                }
            );

            const savedName = path.basename(saveResult.path || normalizedName);
            const dbFilePath = storage.relativeDbPathForUser(userId, savedName);
            if (!(await storage.exists(dbFilePath))) {
                return res.status(404).json({ error: "Saved scene file was not found" });
            }
            const { size } = await storage.stat(dbFilePath);
            if (size <= 0) {
                return res.status(400).json({ error: "Saved scene file is empty" });
            }

            // Overwrite mode updates the active file by id; save-as-new creates a new record.
            const existing = File.findByStoredName(savedName);
            if (saveMode === "overwrite") {
                const recordToUpdate = overwriteTargetRecord || existing;
                File.updateMetadata(recordToUpdate.id, {
                        originalName: savedName,
                        filePath: dbFilePath,
                        fileSize: size,
                        mimeType: 'application/x-mrb'
                });
                File.touchLastViewed(recordToUpdate.id);
                const overwrittenRow = File.findById(recordToUpdate.id);
                return res.json({
                    success: true,
                    status: "overwritten",
                    path: dbFilePath,
                    file: fileRowToApiSnapshot(overwrittenRow)
                });
            }

            if (existing && existing.user_id === req.user.id) {
                File.touchLastViewed(existing.id);
                const existingRow = File.findById(existing.id);
                return res.json({
                    success: true,
                    status: "already-registered",
                    path: dbFilePath,
                    file: fileRowToApiSnapshot(existingRow)
                });
            }

            const fileRecord = File.create({
                userId: req.user.id,
                originalName: savedName,
                storedName: savedName,
                filePath: dbFilePath,
                fileSize: size,
                mimeType: 'application/x-mrb'
            });
            File.touchLastViewed(fileRecord.id);

            const createdRow = File.findById(fileRecord.id);
            res.json({
                success: true,
                status: "registered",
                path: dbFilePath,
                file: fileRowToApiSnapshot(createdRow)
            });
        } catch (err) {
            console.error("Error saving trame session:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get("/api/containers/view-state", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        try {
            const trameServiceUrl = resolveTrameServiceUrl(userId);
            const sessions = await httpRequest(`${trameServiceUrl}/api/sessions`);
            const userSession = sessions.sessions?.find(s => s.userId === userId);
            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }
            const state = await httpRequest(`${trameServiceUrl}/api/sessions/${userSession.sessionId}/view-state`, {
                method: 'GET'
            });
            return res.json({
                sessionId: userSession.sessionId,
                viewState: state?.viewState || null
            });
        } catch (err) {
            console.error("Error reading trame view state:", err);
            return res.status(500).json({ error: err.message });
        }
    });

    // Heartbeat — extends browser tab lease; Trame service lease when userActive.
    app.post("/api/containers/heartbeat", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        const userActive = req.body?.userActive === true;
        const sessionToken = String(req.body?.sessionToken || '').trim();

        try {
            let browserLease = null;
            if (sessionToken) {
                browserLease = touchViewerSession(SESSION_KINDS.TRAME, userId, sessionToken);
            }

            const trameServiceUrl = resolveTrameServiceUrl(userId);
            const sessions = await httpRequest(`${trameServiceUrl}/api/sessions`);
            const userSession = sessions.sessions?.find((s) => s.userId === userId);

            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }

            const hb = await httpRequest(
                `${trameServiceUrl}/api/sessions/${userSession.sessionId}/heartbeat`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: { userActive }
                }
            );

            const trameCtx = getUserTrameContext(userId);
            if (userActive && trameCtx?.projectId) {
                touchProjectBillingActivity(trameCtx.projectId);
            }

            return res.json({
                success: true,
                status: "running",
                sessionId: userSession.sessionId,
                leaseExpiresAt: browserLease
                    ? new Date(browserLease.leaseExpiresAt).toISOString()
                    : (hb.leaseExpiresAt ?? null),
                sessionTtlSeconds: browserLease
                    ? getSessionTtlSeconds(SESSION_KINDS.TRAME)
                    : (hb.sessionTtlSeconds ?? sessions.sessionTtlSeconds ?? null),
                maxSessionWallSeconds: hb.maxSessionWallSeconds ?? sessions.maxSessionWallSeconds ?? null,
                leaseExtended: !!browserLease || (userActive && hb.leaseExtended !== false)
            });
        } catch (err) {
            console.error("Error extending trame session lease:", err);
            res.status(500).json({ error: err.message });
        }
    });
}
