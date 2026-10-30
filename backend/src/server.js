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
import directusVersionRoutes from "./routes/directusVersions.js";
import directusCaseActivityRoutes from "./routes/directusCaseActivity.js";
import registrationRequestRoutes from "./routes/registrationRequests.js";
import groupRoutes from "./routes/groups.js";
import passwordResetRoutes from "./routes/passwordReset.js";
import featuresRoutes from "./routes/features.js";
import slicerWebRoutes from "./routes/slicerWeb.js";
import announcementRoutes from "./routes/announcement.js";
import { startStablePoller, startLatestPoller } from "./services/slicerWebUpdater.js";
import { ensureVersionsCollection } from "./services/attachmentVersions.js";
import { startPruneScheduler } from "./jobs/pruneVersions.js";
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
import { initPayload, getPayloadClient } from "./payload/index.js";
import { getUsersWithRealmRole } from "./services/keycloakAdmin.js";
import { addGroupMember } from "./services/groupStore.js";
import casesRoutes from "./routes/cases.js";
import caseCollaboratorsRoutes from "./routes/caseCollaborators.js";
import { registerCaseTusRoute } from "./routes/caseTus.js";

async function expireStaleInvites() {
    const payload = getPayloadClient();
    if (!payload) return;
    try {
        const stale = await payload.find({
            collection: 'case-invites',
            where: {
                status:     { equals: 'pending_signup' },
                expires_at: { less_than: new Date().toISOString() },
            },
            limit: 200,
            depth: 0,
        });
        for (const inv of stale.docs) {
            await payload.update({ collection: 'case-invites', id: inv.id, data: { status: 'expired' } });
        }
        if (stale.docs.length) {
            console.log(`Expired ${stale.docs.length} stale case invite(s)`);
        }
    } catch (err) {
        console.warn('Case invite expiry sweep failed:', err.message);
    }
}

async function seedRegistrationReviewersGroup() {
    const payload = getPayloadClient();
    if (!payload) return;
    try {
        // Ensure the group exists
        let groupId;
        let justCreated = false;
        const existing = await payload.find({
            collection: 'groups',
            where: { name: { equals: 'Registration Reviewers' } },
            limit: 1,
            depth: 0,
        });
        if (existing.totalDocs === 0) {
            const created = await payload.create({
                collection: 'groups',
                data: {
                    name: 'Registration Reviewers',
                    description: 'Members of this group can approve new user registration requests.',
                    can_approve_registrations: true,
                },
            });
            groupId = String(created.id);
            justCreated = true;
            console.log('Seeded "Registration Reviewers" group');
        } else {
            groupId = String(existing.docs[0].id);
        }

        // Seed members if the group was just created OR has no members yet
        // (handles the case where KC was unavailable on first run).
        // Once members exist, manual removals are respected.
        const memberCheck = await payload.find({
            collection: 'group-members',
            where: { group_id: { equals: groupId } },
            limit: 1,
            depth: 0,
        });
        if (!justCreated && memberCheck.totalDocs > 0) return;

        const [orgAdmins, admins] = await Promise.all([
            getUsersWithRealmRole('app-org-admin'),
            getUsersWithRealmRole('app-admin'),
        ]);
        console.log(`[seed] app-org-admin users: ${orgAdmins.map(u => u.email).join(', ') || '(none)'}`);
        console.log(`[seed] app-admin users: ${admins.map(u => u.email).join(', ') || '(none)'}`);
        const adminSubs = [...new Map(
            [...orgAdmins, ...admins].filter(u => u.id).map(u => [u.id, u])
        ).values()].map(u => u.id);

        if (!adminSubs.length) {
            console.warn('Registration Reviewers: no org-admins found in Keycloak — group left empty');
            return;
        }

        let added = 0;
        for (const kcSub of adminSubs) {
            try {
                await addGroupMember(groupId, kcSub, { canManageGroup: false });
                added++;
            } catch (err) {
                if (err.code !== 'ALREADY_MEMBER') {
                    console.warn(`[seed] addGroupMember(${kcSub}) failed:`, err?.message);
                }
            }
        }
        if (added) console.log(`Added ${added} org-admin(s) to "Registration Reviewers"`);
    } catch (err) {
        console.warn('Registration Reviewers group seed failed:', err.message);
    }
}

function startInviteExpiryWatchdog() {
    const INTERVAL_MS = 60 * 60 * 1000; // hourly
    expireStaleInvites();
    setInterval(expireStaleInvites, INTERVAL_MS);
    console.log('Case invite expiry watchdog started (1 h interval)');
}

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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    credentials: true
}));

// Register authentication routes
authRoutes(app);
adminProvisionRoutes(app);
registrationRequestRoutes(app);
groupRoutes(app);
passwordResetRoutes(app);

featuresRoutes(app);
slicerWebRoutes(app);
announcementRoutes(app);

// Register file routes
fileRoutes(app);

// Register user routes
userRoutes(app);

// Register project routes
projectRoutes(app);
projectGpuRoutes(app);

// Payload Cases (Phase 2) — /api/cases
// caseCollaboratorsRoutes must come first: its /api/cases/lookup-user route
// would otherwise be swallowed by the /api/cases/:id handler in casesRoutes.
caseCollaboratorsRoutes(app);
casesRoutes(app);

// Directus PoC (headless case list behind app auth)
directusRoutes(app);
directusTusRoutes(app);
directusVersionRoutes(app);
directusCaseActivityRoutes(app);

// Register container routes
containerRoutes(app);

// Payload TUS upload route — registered after Payload initializes.
// Must happen before error handlers so Express can match it.
await initPayload();
const payloadClient = getPayloadClient();
if (payloadClient) registerCaseTusRoute(app, payloadClient);

// Error handling - MUST be after all routes
app.use(notFoundHandler);  // Handles 404s
app.use(errorHandler);     // Handles all other errors

// Listen on all interfaces so Docker and host can access
app.listen(config.server.port, config.server.host, async () => {
    console.log(`Backend listening on ${config.server.host}:${config.server.port}`);
    console.log(`Environment: ${config.env}`);
    if (config.directus.casesEnabled && isDirectusConfigured()) {
        console.log('Directus Cases: enabled (BFF /api/directus/*)');
        ensureVersionsCollection().catch((err) =>
            console.warn('Version collection bootstrap failed:', err.message)
        );
    } else if (isDirectusConfigured()) {
        console.log('Directus Cases: disabled (set ENABLE_DIRECTUS_CASES=true to expose)');
    } else {
        console.log('Directus PoC: not configured (set DIRECTUS_URL + DIRECTUS_TOKEN)');
    }
    if (config.directus.casesEnabled && config.versioning.retentionEnabled) {
        startPruneScheduler();
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
    startInviteExpiryWatchdog();
    seedRegistrationReviewersGroup();
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
