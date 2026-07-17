import Project from '../models/Project.js';
import ProjectGpu from '../models/ProjectGpu.js';
import File from '../models/File.js';
import User from '../models/User.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../utils/errors.js';
import { buildViewerFrontendUrl } from '../utils/viewerUrl.js';
import { listProviders, getProvider } from '../gpu/registry.js';
import { startBilling, stopBilling, touchProjectBillingActivity, acknowledgeGpuError, evaluateRemoteBillingStop, reportRemoteProvisionFailure } from '../gpu/orchestrator.js';
import { computeBillingLease } from '../gpu/billingPolicy.js';
import {
    buildBillingOwnerPublic,
    canStartRemoteBilling,
    canStopRemoteBilling,
    cascadeTransferOwnership,
    getBillingOwnerUserId,
    listActiveBillingUsers,
    listOwnedRunningBillingSessions,
    suppressBillingUserPresenceAfterHandoff,
    touchBillingUserPresence
} from '../gpu/billingOwnership.js';
import { enqueuePrestage, isPrestageActive } from '../gpu/prestage.js';
import { reconcileProjectGpu } from '../gpu/reconcile.js';
import { isFileStaged } from '../gpu/syncKeys.js';
import { maskSecret } from '../gpu/credentials.js';
import { parseGpuError, GPU_ERROR_SOURCES } from '../gpu/errors.js';
import { verifyVastApiKey } from '../gpu/providers/vast/client.js';
import {
    ensureSlicerGuiSession,
    touchSlicerGuiSessionHeartbeat,
    releaseSlicerGuiSession,
    stopSlicerGuiSession
} from '../slicerGui/sessionManager.js';
import {
    getSessionTtlSeconds,
    SESSION_KINDS,
    getWarmIdleTtlSeconds,
    VIEWER_RELEASE_MODES
} from '../sessions/index.js';
import { normalizeViewerReleaseMode } from '../sessions/config.js';
import { patchSessionMetadata } from '../sessions/leaseRegistry.js';
import { stageProjectFileForSlicerGui, readSlicerGuiBusyStatus } from '../slicerGui/stageFile.js';
import {
    buildSlicerGuiViewerPath,
    writeLastLoadedFile,
    clearLastLoadedFile
} from '../slicerGui/paths.js';
import {
    isVastFullSlicerMode,
    openFileOnRemoteFullSlicer,
    issueRemoteFullSlicerSession,
    validateRemoteFullSlicerSession,
    remoteFullSlicerViewerPath
} from '../gpu/remoteFullSlicer.js';

/**
 * Prefer an explicit launch flag, then account prefs.
 * Legacy project GPU viewer flags are ignored (they caused stale Simplified mode).
 */
function resolveUseSimplifiedViewer({ body, userId }) {
    if (body?.useSimplifiedViewer !== undefined) {
        return body.useSimplifiedViewer === true;
    }
    const accountPrefs = User.getPreferences(userId);
    return accountPrefs?.useSimplifiedViewer === true;
}

function requireLocalGpu(projectId, unavailableMessage) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId !== 'local') {
        throw new ValidationError(unavailableMessage);
    }
    return settings;
}

/** Local Full Slicer, or Vast when VAST_GPU_MODE=full-slicer and billing is running. */
function requireFullSlicerAvailable(projectId) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') {
        return { mode: 'local', settings };
    }
    if (settings.providerId === 'vast' && isVastFullSlicerMode()) {
        const instance = ProjectGpu.getInstance(projectId);
        if (!ProjectGpu.isRemoteRunning(instance)) {
            throw new ValidationError('Start GPU billing before opening Full Slicer on Vast');
        }
        return { mode: 'remote-full-slicer', settings, instance };
    }
    throw new ValidationError(
        'Full Slicer is only available on Local GPU, or Vast with VAST_GPU_MODE=full-slicer'
    );
}

async function ensureLocalFullSlicerSeat(req, { failureMessage }) {
    const useSimplifiedViewer = resolveUseSimplifiedViewer({
        body: req.body,
        userId: req.user.id
    });
    const launcherUserId = String(req.user.id);
    try {
        const session = await ensureSlicerGuiSession({
            userId: launcherUserId,
            useSimplifiedViewer
        });
        return { launcherUserId, useSimplifiedViewer, session };
    } catch (err) {
        throw new ValidationError(
            err.message || failureMessage
        );
    }
}

function canAccessProjectFile(file, { projectId, userId }) {
    if (!file) return false;
    const projectRole = Project.findForUser({ projectId, userId })?.userRole;
    return file.project_id === projectId
        || file.user_id === userId
        || projectRole === 'admin'
        || projectRole === 'collaborator'
        || projectRole === 'observer';
}

function buildConfiguredProviders(projectId) {
    const settings = ProjectGpu.getSettings(projectId);
    const defaultId = settings.defaultProviderId || 'local';
    const { store, unreadable } = ProjectGpu.getCredentialStore(projectId);
    const configured = [{
        id: 'local',
        label: 'Local',
        configured: true,
        isDefault: defaultId === 'local'
    }];
    const seen = new Set(['local']);

    function addRemoteProvider(providerId, { credentialsUnreadable = false, apiKeyMasked = '' } = {}) {
        if (!providerId || providerId === 'local' || seen.has(providerId)) return;
        const meta = listProviders().find((provider) => provider.id === providerId);
        if (!meta) return;
        seen.add(providerId);
        configured.push({
            id: providerId,
            label: meta.label,
            configured: true,
            isDefault: defaultId === providerId,
            credentialsUnreadable,
            apiKeyMasked: apiKeyMasked || undefined
        });
    }

    if (unreadable) {
        addRemoteProvider(settings.providerId, { credentialsUnreadable: true });
        addRemoteProvider(settings.defaultProviderId, { credentialsUnreadable: true });
        return configured;
    }

    for (const provider of listProviders()) {
        if (provider.id === 'local') continue;
        const creds = store.providers?.[provider.id];
        if (creds?.apiKey) {
            addRemoteProvider(provider.id, { apiKeyMasked: maskSecret(creds.apiKey) });
        }
    }
    return configured;
}

function publicGpuSettings(projectId) {
    const settings = ProjectGpu.getSettings(projectId);
    return {
        providerId: settings.providerId,
        defaultProviderId: settings.defaultProviderId,
        hasApiKey: settings.hasApiKey,
        apiKeyMasked: settings.apiKeyMasked,
        credentialsUnreadable: !!settings.credentialsUnreadable,
        useFullSlicer: settings.useFullSlicer === true,
        useSimplifiedViewer: settings.useSimplifiedViewer === true,
        updatedAt: settings.updatedAt,
        configuredProviders: buildConfiguredProviders(projectId)
    };
}

function requireProjectAdmin(projectId, userId) {
    const project = Project.findForUser({ projectId, userId });
    if (!project) {
        throw new ValidationError('Project not found or inaccessible');
    }
    if (project.userRole !== 'admin') {
        throw new ValidationError('Only project admins can manage GPU settings');
    }
    return project;
}

function parseProjectId(raw) {
    const projectId = Number(raw);
    if (!Number.isInteger(projectId) || projectId <= 0) {
        throw new ValidationError('Invalid project id');
    }
    return projectId;
}

function requireProjectAccess(projectId, userId) {
    const project = Project.findForUser({ projectId, userId });
    if (!project) {
        throw new ValidationError('Project not found or inaccessible');
    }
    return project;
}

function publicInstance(instance) {
    if (!instance) return instance;
    const metadata = { ...(instance.metadata || {}) };
    delete metadata.syncToken;
    delete metadata.billingPresence;
    const syncedFiles = metadata.syncedFiles || {};
    const stagedFiles = Object.entries(syncedFiles).map(([key, info]) => ({
        key,
        bytes: info?.bytes ?? null,
        syncedAt: info?.syncedAt ?? null
    }));
    const parsedError = instance.errorMessage ? parseGpuError(instance.errorMessage) : null;
    return {
        ...instance,
        errorMessage: parsedError?.displayMessage || instance.errorMessage || null,
        errorSource: parsedError?.source || null,
        metadata,
        stagedFiles
    };
}

function requireBillingStarter(projectId, userId) {
    const project = requireProjectAccess(projectId, userId);
    const settings = ProjectGpu.getSettings(projectId);
    if (!canStartRemoteBilling(project, settings)) {
        throw new ValidationError(
            'Only project admins or collaborators can start billing when remote credentials are configured'
        );
    }
    return { project, settings };
}

function requireBillingStopper(projectId, userId) {
    const project = requireProjectAccess(projectId, userId);
    const instance = ProjectGpu.getInstance(projectId);
    if (!canStopRemoteBilling(project, instance, userId)) {
        throw new ValidationError(
            'Only the billing owner or a project admin can stop billing'
        );
    }
    return { project, instance };
}

export default function projectGpuRoutes(app) {
    app.get('/api/gpu/providers', authenticateToken, asyncHandler(async (_req, res) => {
        res.json({ providers: listProviders() });
    }));

    /** Projects where the current user owns running remote GPU billing (logout reminder). */
    app.get('/api/gpu/owned-billing-sessions', authenticateToken, asyncHandler(async (req, res) => {
        res.json({ sessions: listOwnedRunningBillingSessions(req.user.id) });
    }));

    app.get('/api/projects/:projectId/gpu', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        const project = Project.findForUser({ projectId, userId: req.user.id });
        if (!project) {
            throw new ValidationError('Project not found or inaccessible');
        }

        const before = ProjectGpu.getInstance(projectId);
        const reconcile = await reconcileProjectGpu(projectId, {
            force: ['provisioning', 'stopping'].includes(before?.status)
        });
        const settings = ProjectGpu.getSettings(projectId);
        let instance = reconcile.instance || ProjectGpu.getInstance(projectId);

        let remoteProvision = null;
        if (instance?.status === 'provisioning' && instance?.instanceId && settings.providerId !== 'local') {
            try {
                const provider = getProvider(settings.providerId);
                if (typeof provider.getProvisionStatus === 'function') {
                    const credentials = ProjectGpu.getCredentials(projectId);
                    remoteProvision = await provider.getProvisionStatus({
                        credentials,
                        instanceId: instance.instanceId
                    });
                    if (remoteProvision?.failure && instance?.status === 'provisioning') {
                        await reportRemoteProvisionFailure({
                            projectId,
                            message: remoteProvision.failure,
                            source: GPU_ERROR_SOURCES.VAST
                        });
                        instance = ProjectGpu.getInstance(projectId);
                    }
                }
            } catch (err) {
                console.warn(`GPU provision status check failed for project ${projectId}:`, err.message);
            }
        }

        const publicInst = publicInstance(instance) || {
            projectId,
            providerId: settings.providerId,
            status: 'idle'
        };
        const syncedFiles = instance?.metadata?.syncedFiles || {};
        const stagedFileIds = File.findByProjectId(projectId)
            .filter((file) => isFileStaged(file, syncedFiles, req.user.id, {
                vastFullSlicer: settings.providerId === 'vast' && isVastFullSlicerMode()
            }))
            .map((file) => file.id);

        res.json({
            settings: publicGpuSettings(projectId),
            instance: publicInst,
            billingLease: computeBillingLease(instance),
            billingOwnership: buildBillingOwnerPublic(projectId, req.user.id),
            canManage: project.userRole === 'admin',
            canStartBilling: canStartRemoteBilling(project, settings),
            canStopBilling: canStopRemoteBilling(project, instance, req.user.id),
            prestageActive: isPrestageActive(projectId),
            stagedFileIds,
            vastGpuMode: settings.providerId === 'vast'
                ? (isVastFullSlicerMode() ? 'full-slicer' : 'trame')
                : null,
            reconcileChanged: reconcile.changed,
            reconcileReason: reconcile.reason || null,
            remoteActivity: reconcile.remoteActivity || null,
            remoteProvision
        });
    }));

    app.post('/api/projects/:projectId/gpu/heartbeat', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const instance = ProjectGpu.getInstance(projectId);
        if (!ProjectGpu.isRemoteRunning(instance)) {
            return res.status(404).json({
                error: { message: 'No active remote GPU billing for this project' }
            });
        }

        const viewerActive = req.body?.viewerActive === true;
        touchBillingUserPresence(projectId, req.user.id, { viewerActive });

        const reconcile = await reconcileProjectGpu(projectId, { force: true });
        const current = reconcile.instance || ProjectGpu.getInstance(projectId);
        if (!ProjectGpu.isRemoteRunning(current)) {
            return res.json({
                success: true,
                status: current?.status || 'idle',
                billingStopped: true,
                reason: reconcile.reason || current?.errorMessage || null,
                instance: publicInstance(current),
                remoteActivity: reconcile.remoteActivity || null,
                billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
            });
        }

        if (viewerActive) {
            touchProjectBillingActivity(projectId);
        } else {
            const stopResult = await evaluateRemoteBillingStop(projectId, { viewerActive: false });
            if (stopResult.stopped) {
                const stoppedInstance = ProjectGpu.getInstance(projectId);
                return res.json({
                    success: true,
                    billingStopped: true,
                    reason: stopResult.reason,
                    status: stoppedInstance?.status || 'idle',
                    instance: publicInstance(stoppedInstance),
                    remoteActivity: stopResult.remoteActivity || null,
                    billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
                });
            }
            if (stopResult.transferred) {
                return res.json({
                    success: true,
                    status: 'running',
                    ownershipTransferred: true,
                    billingOwner: stopResult.owner || null,
                    billingLease: computeBillingLease(ProjectGpu.getInstance(projectId)),
                    remoteActivity: stopResult.remoteActivity || null,
                    billingOwnership: buildBillingOwnerPublic(projectId, req.user.id),
                    billingExtended: false
                });
            }
        }
        const updated = ProjectGpu.getInstance(projectId);
        const lease = computeBillingLease(updated);

        res.json({
            success: true,
            status: 'running',
            billingLease: lease,
            remoteActivity: reconcile.remoteActivity || null,
            billingOwnership: buildBillingOwnerPublic(projectId, req.user.id),
            billingExtended: viewerActive
        });
    }));

    app.put('/api/projects/:projectId/gpu/settings', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAdmin(projectId, req.user.id);

        const configureProvider = String(req.body?.configureProvider || '').trim();
        if (configureProvider) {
            getProvider(configureProvider);
            const credentials = {};
            if (typeof req.body?.apiKey === 'string' && req.body.apiKey.trim()) {
                credentials.apiKey = req.body.apiKey.trim();
            }
            if (configureProvider === 'vast' && credentials.apiKey) {
                await verifyVastApiKey(credentials.apiKey);
            }
            try {
                ProjectGpu.configureProvider({
                    projectId,
                    providerId: configureProvider,
                    credentials,
                    useNow: req.body?.useNow === true || req.body?.setAsDefault === true,
                    updatedByUserId: req.user.id
                });
            } catch (err) {
                throw new ValidationError(err.message || 'Unable to configure GPU provider');
            }
        } else if (req.body?.defaultProviderId !== undefined) {
            const defaultProviderId = String(req.body.defaultProviderId || 'local').trim();
            getProvider(defaultProviderId);
            try {
                ProjectGpu.setDefaultProvider({
                    projectId,
                    providerId: defaultProviderId,
                    updatedByUserId: req.user.id
                });
            } catch (err) {
                throw new ValidationError(err.message || 'Unable to set default GPU provider');
            }
        } else if (
            req.body?.useFullSlicer !== undefined
            || req.body?.useSimplifiedViewer !== undefined
        ) {
            try {
                const before = ProjectGpu.getSettings(projectId);
                const patch = { projectId, updatedByUserId: req.user.id };
                if (req.body?.useFullSlicer !== undefined) {
                    patch.useFullSlicer = req.body.useFullSlicer === true;
                }
                if (req.body?.useSimplifiedViewer !== undefined) {
                    patch.useSimplifiedViewer = req.body.useSimplifiedViewer === true;
                }
                ProjectGpu.setLocalOptions(patch);
                const after = ProjectGpu.getSettings(projectId);
                const fullSlicerModeChanged = (
                    before.useFullSlicer !== after.useFullSlicer
                    || before.useSimplifiedViewer !== after.useSimplifiedViewer
                );
                if (fullSlicerModeChanged) {
                    await stopSlicerGuiSession({ userId: String(req.user.id) });
                }
            } catch (err) {
                throw new ValidationError(err.message || 'Unable to update local viewer option');
            }
        } else {
            const providerId = String(req.body?.providerId || 'local').trim();
            getProvider(providerId);
            try {
                ProjectGpu.setActiveProvider({
                    projectId,
                    providerId,
                    updatedByUserId: req.user.id
                });
            } catch (err) {
                throw new ValidationError(err.message || 'Unable to switch GPU provider');
            }
        }

        res.json({ settings: publicGpuSettings(projectId) });
    }));

    app.post('/api/projects/:projectId/gpu/start', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireBillingStarter(projectId, req.user.id);

        const result = await startBilling({ projectId, userId: req.user.id });
        const instance = ProjectGpu.getInstance(projectId);
        res.json({
            ...result,
            instance: publicInstance(instance),
            billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
        });
    }));

    app.post('/api/projects/:projectId/gpu/stop', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireBillingStopper(projectId, req.user.id);

        const force = req.body?.force === true || req.body?.acknowledgeImpact === true;
        const ownerId = getBillingOwnerUserId(ProjectGpu.getInstance(projectId));
        const othersActive = listActiveBillingUsers(projectId, {
            excludeUserIds: ownerId ? [ownerId] : []
        }).filter((u) => u.userId !== req.user.id);

        if (othersActive.length > 0 && !force) {
            return res.status(409).json({
                error: {
                    message: 'Stopping billing will disconnect other active users. Transfer ownership or confirm stop.',
                    code: 'billing_stop_impact'
                },
                impact: {
                    activeUsers: othersActive,
                    transferTarget: othersActive[0] || null
                },
                billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
            });
        }

        const result = await stopBilling({ projectId, reason: 'user_stop' });
        const instance = ProjectGpu.getInstance(projectId);
        res.json({
            ...result,
            instance: publicInstance(instance),
            billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
        });
    }));

    app.post('/api/projects/:projectId/gpu/transfer-billing', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireBillingStopper(projectId, req.user.id);

        const instance = ProjectGpu.getInstance(projectId);
        if (!ProjectGpu.isRemoteRunning(instance)) {
            throw new ValidationError('No active remote GPU billing to transfer');
        }

        const result = cascadeTransferOwnership(projectId, {
            excludeUserIds: [req.user.id]
        });

        if (!result.transferred) {
            const stopResult = await stopBilling({ projectId, reason: 'transfer_exhausted' });
            return res.json({
                transferred: false,
                stopped: true,
                reason: 'No other active users to transfer to; billing stopped.',
                ...stopResult,
                instance: publicInstance(ProjectGpu.getInstance(projectId)),
                billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
            });
        }

        // Transferor is idle for transfer purposes until they open a viewer again.
        suppressBillingUserPresenceAfterHandoff(projectId, req.user.id);

        res.json({
            transferred: true,
            stopped: false,
            owner: result.owner,
            instance: publicInstance(ProjectGpu.getInstance(projectId)),
            billingOwnership: buildBillingOwnerPublic(projectId, req.user.id)
        });
    }));

    app.post('/api/projects/:projectId/gpu/acknowledge-error', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAdmin(projectId, req.user.id);

        const result = await acknowledgeGpuError({ projectId });
        const instance = ProjectGpu.getInstance(projectId);
        res.json({ ...result, instance: publicInstance(instance) });
    }));

    app.post('/api/projects/:projectId/gpu/open-full-slicer', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);
        const availability = requireFullSlicerAvailable(projectId);

        const fileId = Number(req.body?.fileId);
        if (!Number.isInteger(fileId) || fileId <= 0) {
            throw new ValidationError('fileId is required');
        }

        const file = File.findById(fileId);
        if (!canAccessProjectFile(file, { projectId, userId: req.user.id })) {
            throw new ValidationError('File not found or inaccessible');
        }

        // --- Vast Full Slicer spike (single seat on the rented instance) ---
        if (availability.mode === 'remote-full-slicer') {
            const useSimplifiedViewer = resolveUseSimplifiedViewer({
                body: req.body,
                userId: req.user.id
            });
            const launcherUserId = String(req.user.id);
            const staged = await openFileOnRemoteFullSlicer(availability.instance, {
                file,
                launcherUserId,
                useSimplifiedViewer
            });
            File.touchLastViewed(file.id);
            touchProjectBillingActivity(projectId);
            touchBillingUserPresence(projectId, req.user.id, { viewerActive: true });

            const sessionToken = issueRemoteFullSlicerSession({
                projectId,
                userId: launcherUserId,
                fileId: file.id
            });
            const viewerPath = remoteFullSlicerViewerPath();
            const frontendUrl = buildViewerFrontendUrl(req, launcherUserId, null, null);
            const origin = frontendUrl ? new URL(frontendUrl).origin : `${req.protocol}://${req.get('host')}`;
            const slicerGuiUrl = `${origin}${viewerPath}`;

            return res.json({
                slicerGuiUrl,
                vncPath: viewerPath,
                sessionId: `vast-full-slicer-${projectId}`,
                sessionToken,
                userId: launcherUserId,
                fileName: staged.fileName,
                containerPath: staged.containerPath || null,
                useSimplifiedViewer: staged.useSimplifiedViewer === true,
                sessionReused: false,
                sceneReloaded: true,
                remoteFullSlicer: true,
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
                warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI)
            });
        }

        const { launcherUserId, useSimplifiedViewer, session } = await ensureLocalFullSlicerSeat(req, {
            failureMessage: 'Unable to start local Full Slicer session. Is the slicer-gui image built?'
        });

        // Only skip restage when this seat actually had the scene loaded
        // (soft-close reopen). Empty prepare warm must never skip.
        const sameFileAlreadyLoaded = session.reused === true
            && session.sceneLoaded === true
            && Number(session.lastLoadedFileId) === fileId;
        let staged;
        let sceneReloaded = true;
        if (sameFileAlreadyLoaded) {
            sceneReloaded = false;
            staged = {
                fileName: file.original_name,
                useSimplifiedViewer,
                skipped: true
            };
            console.log('Skipping Full Slicer restage (warm seat already has file)', {
                userId: launcherUserId,
                fileId
            });
        } else {
            staged = await stageProjectFileForSlicerGui({
                file,
                launcherUserId,
                useSimplifiedViewer
            });
            patchSessionMetadata(SESSION_KINDS.SLICER_GUI, launcherUserId, {
                lastLoadedFileId: file.id,
                lastLoadedFileName: staged.fileName,
                sceneLoaded: false
            });
            writeLastLoadedFile(launcherUserId, {
                fileId: file.id,
                fileName: staged.fileName,
                useSimplifiedViewer,
                sceneLoaded: false
            });
        }
        File.touchLastViewed(file.id);

        const viewerPath = buildSlicerGuiViewerPath(launcherUserId);
        const frontendUrl = buildViewerFrontendUrl(req, launcherUserId, null, null);
        const origin = frontendUrl ? new URL(frontendUrl).origin : `${req.protocol}://${req.get('host')}`;
        const slicerGuiUrl = `${origin}${viewerPath.startsWith('/') ? viewerPath : `/${viewerPath}`}`;

        res.json({
            slicerGuiUrl,
            vncPath: viewerPath,
            sessionId: session.containerName,
            sessionToken: session.sessionToken,
            userId: launcherUserId,
            fileName: staged.fileName,
            containerPath: staged.containerPath || null,
            useSimplifiedViewer: staged.useSimplifiedViewer === true || useSimplifiedViewer === true,
            sessionReused: session.reused === true,
            sceneReloaded,
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
            warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI)
        });
    }));

    app.post('/api/projects/:projectId/gpu/full-slicer-heartbeat', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError('sessionToken is required');
        }

        const settings = ProjectGpu.getSettings(projectId);
        if (settings.providerId === 'vast' && isVastFullSlicerMode()) {
            if (!validateRemoteFullSlicerSession({
                projectId,
                userId: req.user.id,
                sessionToken
            })) {
                return res.status(404).json({
                    error: { message: 'Full Slicer session not found or expired' }
                });
            }
            touchProjectBillingActivity(projectId);
            touchBillingUserPresence(projectId, req.user.id, { viewerActive: true });
            return res.json({
                success: true,
                remoteFullSlicer: true,
                sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI)
            });
        }

        requireLocalGpu(projectId, 'Full Slicer viewer is only available when Local GPU is active');

        const userId = String(req.user.id);
        const lease = touchSlicerGuiSessionHeartbeat({ userId, sessionToken });
        if (!lease) {
            return res.status(404).json({
                error: { message: 'Full Slicer session not found or expired' }
            });
        }

        res.json({
            success: true,
            leaseExpiresAt: new Date(lease.leaseExpiresAt).toISOString(),
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI)
        });
    }));

    app.post('/api/projects/:projectId/gpu/reconnect-full-slicer', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);
        requireLocalGpu(projectId, 'Full Slicer viewer is only available when Local GPU is active');

        const { launcherUserId, useSimplifiedViewer, session } = await ensureLocalFullSlicerSeat(req, {
            failureMessage: 'Unable to reconnect local Full Slicer session. Is the slicer-gui image built?'
        });

        const fileId = Number(req.body?.fileId);
        let staged = null;
        if (Number.isInteger(fileId) && fileId > 0) {
            const file = File.findById(fileId);
            if (canAccessProjectFile(file, { projectId, userId: req.user.id })) {
                staged = await stageProjectFileForSlicerGui({
                    file,
                    launcherUserId,
                    useSimplifiedViewer
                });
            }
        }

        const viewerPath = buildSlicerGuiViewerPath(launcherUserId);
        res.json({
            vncPath: viewerPath,
            sessionToken: session.sessionToken,
            userId: launcherUserId,
            fileName: staged?.fileName || null,
            useSimplifiedViewer,
            sessionReused: session.reused === true,
            sessionTtlSeconds: getSessionTtlSeconds(SESSION_KINDS.SLICER_GUI),
            warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI)
        });
    }));

    /** Background warm seat: start Full Slicer (no file) and park it. */
    app.post('/api/projects/:projectId/gpu/prepare-full-slicer', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);
        requireLocalGpu(projectId, 'Full Slicer prepare is only available when Local GPU is active');

        const { launcherUserId, useSimplifiedViewer, session } = await ensureLocalFullSlicerSeat(req, {
            failureMessage: 'Unable to prepare local Full Slicer session. Is the slicer-gui image built?'
        });

        // Empty warm seat must not inherit a stale last-loaded claim from disk.
        const keepScene = session.reused === true && session.sceneLoaded === true;
        if (!keepScene) {
            clearLastLoadedFile(launcherUserId);
            patchSessionMetadata(SESSION_KINDS.SLICER_GUI, launcherUserId, {
                lastLoadedFileId: null,
                lastLoadedFileName: null,
                sceneLoaded: false
            });
        }

        const parked = await releaseSlicerGuiSession({
            userId: launcherUserId,
            sessionToken: session.sessionToken,
            mode: VIEWER_RELEASE_MODES.SOFT
        });

        res.json({
            ready: true,
            sessionReused: session.reused === true,
            sceneLoaded: keepScene,
            useSimplifiedViewer,
            warmIdleSeconds: getWarmIdleTtlSeconds(SESSION_KINDS.SLICER_GUI),
            leaseExpiresAt: parked.leaseExpiresAt || null,
            containerName: parked.containerName || session.containerName
        });
    }));

    app.post('/api/projects/:projectId/gpu/stop-full-slicer', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const sessionToken = String(req.body?.sessionToken || '').trim();
        if (!sessionToken) {
            throw new ValidationError('sessionToken is required');
        }

        const mode = normalizeViewerReleaseMode(req.body?.mode, { supportsSoft: true });
        const result = await releaseSlicerGuiSession({
            userId: String(req.user.id),
            sessionToken,
            mode
        });

        res.json({
            success: true,
            ...result
        });
    }));

    app.get('/api/projects/:projectId/gpu/full-slicer-status', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const status = readSlicerGuiBusyStatus(String(req.user.id));
        res.json(status);
    }));

    app.post('/api/projects/:projectId/gpu/prestage', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const fileIds = Array.isArray(req.body?.fileIds)
            ? req.body.fileIds.map((id) => Number(id)).filter((id) => id > 0)
            : null;

        // Share the project prestage mutex so open/hover/auto cannot race-upload.
        const result = await enqueuePrestage({
            projectId,
            userId: req.user.id,
            fileIds: fileIds?.length ? fileIds : null
        });

        const instance = ProjectGpu.getInstance(projectId);
        res.json({
            ...result,
            instance: publicInstance(instance),
            stagedFileIds: File.findByProjectId(projectId)
                .filter((file) => isFileStaged(file, instance?.metadata?.syncedFiles || {}, req.user.id, {
                    vastFullSlicer: isVastFullSlicerMode()
                }))
                .map((file) => file.id)
        });
    }));
}
