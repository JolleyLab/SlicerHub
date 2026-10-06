import 'dotenv/config';
import Docker from "dockerode";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "./config/index.js";

import containerRoutes from "./routes/containers.js";
import authRoutes from "./routes/auth.js";
import adminProvisionRoutes from "./routes/adminProvision.js";
import fileRoutes from "./routes/files.js";
import userRoutes from "./routes/users.js";
import projectRoutes from "./routes/projects.js";
import projectGpuRoutes from "./routes/projectGpu.js";
import directusRoutes from "./routes/directus.js";
import directusTusRoutes from "./routes/directusTus.js";
import registrationRequestRoutes from "./routes/registrationRequests.js";
import featuresRoutes from "./routes/features.js";
import slicerWebRoutes from "./routes/slicerWeb.js";
import { startStablePoller, startLatestPoller } from "./services/slicerWebUpdater.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { isDirectusConfigured } from "./services/directus.js";
import { startBillingWatchdog } from "./gpu/billingWatchdog.js";
import {
    startViewerSessionWatchdog,
    pruneExpiredViewerSessions,
    stopAllPerUserSlicerGuiContainers,
    stopAllPerUserTrameContainers
} from "./sessions/index.js";
import { clearSessions } from "./sessions/leaseRegistry.js";
import { warnIfGpuCredentialsKeyMissing } from "./gpu/credentials.js";
import { warnIfAuthTokenKeyMissing } from "./auth/tokenCrypto.js";
import { repairGpuCredentialsFromSeed } from "./gpu/repairCredentials.js";
import ProjectGpu from "./models/ProjectGpu.js";
import { restoreGpuViewerProxies } from "./gpu/gpuViewerProxy.js";

function warnIfWeakDemoSecrets() {
    if (config.isProduction) return;

    const syncToken = (process.env.TRAME_SYNC_TOKEN || 'test-sync-token-local').trim();
    if (!syncToken || syncToken === 'test-sync-token-local') {
        console.warn(
            '⚠️  TRAME_SYNC_TOKEN is unset or using the compose default. '
            + 'Set a random token in .env for demo servers reachable from the internet.'
        );
    }

    const weakJwt = new Set([
        'please-change-this-to-a-secure-random-string-in-production',
        'dev-secret-CHANGE-IN-PRODUCTION'
    ]);
    if (weakJwt.has(config.jwt.secret)) {
        console.warn(
            '⚠️  JWT_SECRET is a known default. Set a random value in .env before exposing this server.'
        );
    }
}

// ---------------------
// Docker Setup
// ---------------------
const docker = new Docker({ socketPath: config.docker.socketPath });

// ---------------------
// Express Backend Setup
// ---------------------

const app = express();

// Behind nginx / Cloudflare — needed for secure cookies and rate limits
app.set('trust proxy', 1);

// Raw body for webhook HMAC verification (must precede express.json() — body stream is single-use)
app.use('/api/slicerweb/webhook', express.raw({ type: '*/*' }));

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
adminProvisionRoutes(app);
registrationRequestRoutes(app);

featuresRoutes(app);
slicerWebRoutes(app);

// Register file routes
fileRoutes(app);

// Register user routes
userRoutes(app);

// Register project routes
projectRoutes(app);
projectGpuRoutes(app);

// Directus PoC (headless case list behind app auth)
directusRoutes(app);
directusTusRoutes(app);

// Register container routes
containerRoutes(app);

// Error handling - MUST be after all routes
app.use(notFoundHandler);  // Handles 404s
app.use(errorHandler);     // Handles all other errors

// Listen on all interfaces so Docker and host can access
app.listen(config.server.port, config.server.host, async () => {
    console.log(`Backend listening on ${config.server.host}:${config.server.port}`);
    console.log(`Environment: ${config.env}`);
    if (config.directus.casesEnabled && isDirectusConfigured()) {
        console.log('Directus Cases: enabled (BFF /api/directus/*)');
    } else if (isDirectusConfigured()) {
        console.log('Directus Cases: disabled (set ENABLE_DIRECTUS_CASES=true to expose)');
    } else {
        console.log('Directus PoC: not configured (set DIRECTUS_URL + DIRECTUS_TOKEN)');
    }
    warnIfWeakDemoSecrets();
    warnIfGpuCredentialsKeyMissing();
    warnIfAuthTokenKeyMissing();
    try {
        const { repaired } = await repairGpuCredentialsFromSeed();
        if (repaired > 0) {
            console.log(`GPU credential repair: restored ${repaired} project(s) from seed`);
        }
    } catch (err) {
        console.warn('GPU credential repair on startup failed:', err.message);
    }
    startBillingWatchdog();
    startViewerSessionWatchdog();
    startStablePoller();
    startLatestPoller();
    try {
        clearSessions();
        await stopAllPerUserSlicerGuiContainers();
        await stopAllPerUserTrameContainers();
    } catch (err) {
        console.warn('Viewer session startup cleanup failed:', err.message);
    }
    try {
        await pruneExpiredViewerSessions();
    } catch (err) {
        console.warn('Viewer session startup prune failed:', err.message);
    }
    try {
        await restoreGpuViewerProxies(ProjectGpu.listRunningRemote());
    } catch (err) {
        console.warn('GPU viewer proxy restore on startup failed:', err.message);
    }
    if (config.isDevelopment) {
        console.log('⚠️  Running in DEVELOPMENT mode');
    }
});
