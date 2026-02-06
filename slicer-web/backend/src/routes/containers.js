import { startContainer, stopContainer } from "../docker/containerManager.js";
import { authenticateToken } from "../middleware/authMiddleware.js";
import File from "../models/File.js";
import path from "path";

// Track last activity time for each user's container
const containerActivity = new Map(); // userId -> timestamp

// Cleanup inactive containers every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

setInterval(async () => {
    const now = Date.now();
    for (const [userId, lastActivity] of containerActivity.entries()) {
        if (now - lastActivity > INACTIVITY_TIMEOUT) {
            console.log(`Cleaning up inactive container for user: ${userId}`);
            try {
                await stopContainer(userId);
                containerActivity.delete(userId);
            } catch (err) {
                console.error(`Failed to cleanup container for ${userId}:`, err.message);
            }
        }
    }
}, CLEANUP_INTERVAL);

export default async function containerRoutes(app) {
    app.post("/api/containers/start", authenticateToken, async (req, res) => {
        // Use authenticated user's username as userId
        const userId = req.user.username;
        const { fileId } = req.body;

        try {
            // Build command array
            const command = [
                "python",
                "./trame-slicer/examples/medical_viewer_app.py",
                "--host",
                "0.0.0.0",
                "--port",
                "8080"
            ];

            // If fileId provided, get file path and add to command
            let volumeBinds = [];
            if (fileId) {
                const file = File.findById(fileId);
                if (file && file.user_id === req.user.id) {
                    // Get absolute path to file
                    const absolutePath = path.resolve(file.file_path);

                    // Get file extension from original filename
                    const ext = path.extname(file.original_name);
                    const containerPath = `/data/input_file${ext}`;

                    // Mount the file into the container with proper extension
                    volumeBinds.push(`${absolutePath}:${containerPath}:ro`);

                    // Add file path parameter to command
                    command.push("--file", containerPath);
                }
            }

            const result = await startContainer({
                userId,
                image: "trame-slicer",
                command,
                volumeBinds
            });

            // Track container activity
            containerActivity.set(userId, Date.now());

            res.json({
                containerId: result.containerId,
                frontendUrl: result.frontendUrl
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post("/api/containers/stop", authenticateToken, async (req, res) => {
        // Use authenticated user's username as userId
        const userId = req.user.username;

        try {
            await stopContainer(userId);
            containerActivity.delete(userId);
            res.json({ success: true, message: `Container for ${userId} stopped` });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: err.message });
        }
    });

    // Heartbeat endpoint to keep container alive
    app.post("/api/containers/heartbeat", authenticateToken, async (req, res) => {
        const userId = req.user.username;

        // Update last activity time
        if (containerActivity.has(userId)) {
            containerActivity.set(userId, Date.now());
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "No active container found" });
        }
    });
}
