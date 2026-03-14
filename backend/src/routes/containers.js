import { authenticateToken } from "../middleware/authMiddleware.js";
import File from "../models/File.js";
import path from "path";
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
            
            // If fileId provided, get the file path
            if (fileId) {
                const file = File.findById(fileId);
                if (file && file.user_id === req.user.id) {
                    // Extract just the filename, since it will be mounted at /data in container
                    filePath = path.basename(file.file_path);
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

            // Return URL routed through nginx so the browser doesn't need direct port access
            const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
            const httpUrl = `http://${host}/trame-session/${sessionData.port}/`;

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
