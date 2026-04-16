import { authenticateToken } from "../middleware/authMiddleware.js";
import File from "../models/File.js";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";

// Trame service configuration
const TRAME_SERVICE_URL = process.env.TRAME_SERVICE_URL || "http://localhost:8090";

// Simple HTTP request helper
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
            let originalFileName = null;

            // If fileId provided, get the file path
            if (fileId) {
                const file = File.findById(fileId);
                if (file && file.user_id === req.user.id) {
                    // Extract just the filename, since it will be mounted at /data in container
                    filePath = path.basename(file.file_path);
                    originalFileName = file.original_name;
                }
            }

            // Call trame service to start session
            const sessionData = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: { userId: userId, filePath: filePath, originalFileName: originalFileName, parentFileId: fileId || null }
            });

            // Return URL routed through nginx using userId so nginx can resolve the container by name
            const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
            const httpUrl = `http://${host}/trame-session/user-${sessionData.userId}/`;

            res.json({
                sessionId: sessionData.sessionId,
                frontendUrl: httpUrl
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

    // Helper: call trame-service save and register the resulting file in the DB
    async function doSave(userId, overwrite, res) {
        const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);
        const userSession = sessions.sessions?.find(s => s.userId === userId);
        if (!userSession) return res.status(404).json({ error: "No active session found" });

        const saveResult = await httpRequest(
            `${TRAME_SERVICE_URL}/api/sessions/${userSession.sessionId}/save?overwrite=${overwrite}`,
            { method: 'POST' }
        );

        const userDir = path.join('userFiles', userId);
        const filePath = path.join(userDir, saveResult.filename);
        await new Promise(r => setTimeout(r, 500));

        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ error: "Scene save failed - file not found on disk" });
        }

        const stat = fs.statSync(filePath);

        if (overwrite) {
            // Update existing file record if one with this name exists, otherwise create
            const existing = File.findByUserId(parseInt(userId))
                .find(f => f.original_name === saveResult.filename);
            if (existing) {
                File.update(existing.id, { fileSize: stat.size, filePath });
                return res.json({ success: true, file: { id: existing.id, originalName: saveResult.filename } });
            }
        }

        // Create new record
        const fileRecord = File.create({
            userId: parseInt(userId),
            originalName: saveResult.filename,
            storedName: saveResult.filename,
            filePath,
            fileSize: stat.size,
            mimeType: 'application/x-mrb',
            parentFileId: saveResult.parentFileId || null
        });
        return res.json({ success: true, file: { id: fileRecord.id, originalName: fileRecord.originalName } });
    }

    // Save: overwrite original (saves as {originalName}.mrb)
    app.post("/api/containers/save", authenticateToken, async (req, res) => {
        try {
            await doSave(req.user.id.toString(), true, res);
        } catch (err) {
            console.error("Error saving trame session:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Save as new file: creates a new timestamped annotations MRB
    app.post("/api/containers/save-as", authenticateToken, async (req, res) => {
        try {
            await doSave(req.user.id.toString(), false, res);
        } catch (err) {
            console.error("Error saving trame session as new file:", err);
            res.status(500).json({ error: err.message });
        }
    });

    // Provider info — returns the GPU_PROVIDER the trame-service is using.
    // The frontend uses this to show the right startup message (e.g. GPU booting).
    app.get("/api/provider", authenticateToken, async (req, res) => {
        try {
            const health = await httpRequest(`${TRAME_SERVICE_URL}/health`);
            res.json({
                provider: health.provider || 'docker',
                mock: health.mock || false,
            });
        } catch (err) {
            // If trame-service is unreachable, assume docker (safest default)
            res.json({ provider: 'docker', mock: false });
        }
    });

    // Heartbeat endpoint - check session status
    app.post("/api/containers/heartbeat", authenticateToken, async (req, res) => {
        const userId = req.user.id.toString(); // Use numeric user ID

        try {
            const sessions = await httpRequest(`${TRAME_SERVICE_URL}/api/sessions`);
            
            const userSession = sessions.sessions?.find(s => s.userId === userId);
            
            if (userSession) {
                res.json({ success: true, status: "running" });
            } else {
                res.status(404).json({ error: "No active session found" });
            }
        } catch (err) {
            console.error("Error checking session status:", err);
            res.status(500).json({ error: err.message });
        }
    });
}
