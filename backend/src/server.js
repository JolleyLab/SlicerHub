import 'dotenv/config';
import Docker from "dockerode";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "./config/index.js";

import containerRoutes from "./routes/containers.js";
import authRoutes from "./routes/auth.js";
import fileRoutes from "./routes/files.js";
import userRoutes from "./routes/users.js";
import projectRoutes from "./routes/projects.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

// ---------------------
// Docker Setup
// ---------------------
const docker = new Docker({ socketPath: config.docker.socketPath });

// ---------------------
// Express Backend Setup
// ---------------------

const app = express();

// Parse JSON bodies
app.use(express.json());

// Parse cookies
app.use(cookieParser());

// Enable CORS for your frontend
app.use(cors({
    origin: config.server.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

// Register authentication routes
authRoutes(app);

// Register file routes
fileRoutes(app);

// Register user routes
userRoutes(app);

// Register project routes
projectRoutes(app);

// Register container routes
containerRoutes(app);

// Error handling - MUST be after all routes
app.use(notFoundHandler);  // Handles 404s
app.use(errorHandler);     // Handles all other errors

// Listen on all interfaces so Docker and host can access
app.listen(config.server.port, config.server.host, () => {
    console.log(`Backend listening on ${config.server.host}:${config.server.port}`);
    console.log(`Environment: ${config.env}`);
    if (config.isDevelopment) {
        console.log('⚠️  Running in DEVELOPMENT mode');
    }
});
