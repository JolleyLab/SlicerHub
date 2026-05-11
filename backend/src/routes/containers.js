import { authenticateToken } from "../middleware/authMiddleware.js";
import File from "../models/File.js";
import Project from "../models/Project.js";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

// Trame service configuration
const TRAME_SERVICE_URL = process.env.TRAME_SERVICE_URL || "http://localhost:8090";

/** Scheme the browser used to reach the app (not necessarily the Express↔nginx hop). */
function getClientFacingProtocol(req) {
    const chain = req.headers["x-forwarded-proto"];
    if (chain) {
        const first = chain.split(",")[0].trim().toLowerCase();
        if (first === "https" || first === "http") return first;
    }
    const cf = req.headers["cf-visitor"];
    if (cf) {
        try {
            const scheme = JSON.parse(cf).scheme;
            if (scheme === "https" || scheme === "http") return scheme;
        } catch {
            /* ignore */
        }
    }
    return req.protocol === "https" ? "https" : "http";
}

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
        const userId = req.user.id.toString(); // Use numeric user ID for file paths
        const { fileId } = req.body;

        try {
            let filePath = null;
            let viewedFileRecord = null;

            // If fileId provided, get the file path
            if (fileId) {
                const file = File.findById(fileId);
                const projectId = Number(file?.project_id);
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
                    // Trame service mounts the launching user's directory. If this file belongs to
                    // someone else, stage a local copy in the launcher's folder first.
                    if (file.user_id !== req.user.id) {
                        const launcherDir = path.join('userFiles', userId);
                        fs.mkdirSync(launcherDir, { recursive: true });

                        const sourcePath = file.file_path;
                        if (sourcePath && fs.existsSync(sourcePath)) {
                            const sharedName = `shared-${file.id}-${path.basename(sourcePath)}`;
                            const targetPath = path.join(launcherDir, sharedName);
                            fs.copyFileSync(sourcePath, targetPath);
                            filePath = sharedName;
                        }
                    } else {
                        // Extract just the filename, since it will be mounted at /data in container.
                        filePath = path.basename(file.file_path);
                    }
                }
            }

            // Call trame service to start session
            const sessionData = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions/start`, {
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
            const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
            const protocol = getClientFacingProtocol(req);
            const frontendUrl = `${protocol}://${host}/trame-session/user-${sessionData.userId}/`;

            res.json({
                sessionId: sessionData.sessionId,
                frontendUrl
            });
        } catch (err) {
            console.error("Error starting trame session:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/containers/stop", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString(); // Use numeric user ID

        try {
            // Get session ID
            const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);

            const userSession = sessions.sessions?.find(s => s.userId === userId);

            if (userSession) {
                await httpRequest(
                    `${TRAME_SERVICE_URL}/api/sessions/${userSession.sessionId}/stop`,
                    { method: 'POST' }
                );
            }

            res.json({ success: true, message: `Session for ${userId} stopped` });
        } catch (err) {
            console.error("Error stopping trame session:", err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/containers/save", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();
        const { saveMode = "overwrite", targetFileName, fileId } = req.body || {};

        try {
            const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);
            const userSession = sessions.sessions?.find(s => s.userId === userId);

            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }

            // Trigger save in the running trame-session container.
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
                `${TRAME_SERVICE_URL}/api/sessions/${userSession.sessionId}/save`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: { targetFileName: normalizedName }
                }
            );

            // Register the saved scene file in DB for UI visibility.
            const userDir = path.join('userFiles', userId);
            if (!fs.existsSync(userDir)) {
                return res.status(404).json({ error: "User file directory not found" });
            }

            const savedName = path.basename(saveResult.path || normalizedName);
            const fullPath = path.join(userDir, savedName);
            if (!fs.existsSync(fullPath)) {
                return res.status(404).json({ error: "Saved scene file was not found" });
            }
            const latest = {
                name: savedName,
                size: fs.statSync(fullPath).size
            };
            if (latest.size <= 0) {
                return res.status(400).json({ error: "Saved scene file is empty" });
            }
            const dbFilePath = path.join('userFiles', userId, savedName);

            // Overwrite mode updates the active file by id; save-as-new creates a new record.
            const existing = File.findByStoredName(savedName);
            if (saveMode === "overwrite") {
                const recordToUpdate = overwriteTargetRecord || existing;
                File.updateMetadata(recordToUpdate.id, {
                        originalName: savedName,
                        filePath: dbFilePath,
                        fileSize: latest.size,
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
                fileSize: latest.size,
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
            const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);
            const userSession = sessions.sessions?.find(s => s.userId === userId);
            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }
            const state = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions/${userSession.sessionId}/view-state`, {
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

    // Heartbeat — extends sliding lease on the Trame service (TTL + optional wall cap).
    app.post("/api/containers/heartbeat", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString();

        try {
            const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);
            const userSession = sessions.sessions?.find((s) => s.userId === userId);

            if (!userSession) {
                return res.status(404).json({ error: "No active session found" });
            }

            const hb = await httpRequest(
                `${TRAME_SERVICE_URL}/api/sessions/${userSession.sessionId}/heartbeat`,
                { method: "POST" }
            );

            return res.json({
                success: true,
                status: "running",
                sessionId: userSession.sessionId,
                leaseExpiresAt: hb.leaseExpiresAt ?? null,
                sessionTtlSeconds: hb.sessionTtlSeconds ?? sessions.sessionTtlSeconds ?? null,
                maxSessionWallSeconds: hb.maxSessionWallSeconds ?? sessions.maxSessionWallSeconds ?? null
            });
        } catch (err) {
            console.error("Error extending trame session lease:", err);
            res.status(500).json({ error: err.message });
        }
    });
}
