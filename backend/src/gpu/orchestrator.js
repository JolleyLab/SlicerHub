import ProjectGpu from '../models/ProjectGpu.js';
import Project from '../models/Project.js';
import storage from '../storage/index.js';
import { getProvider } from './registry.js';
import { resolveSyncTarget } from './syncKeys.js';
import { writeGpuViewerProxy, removeGpuViewerProxy, restoreGpuViewerProxies } from './gpuViewerProxy.js';
import { prestageProjectFilesBackground } from './prestage.js';
import { isBillingCancelledError, isInvalidApiKeyError } from './providers/vast/client.js';
import { ConflictError } from '../utils/errors.js';
import { formatGpuError, GPU_ERROR_SOURCES } from './errors.js';
import { shouldAutoStopBilling, shouldStopBillingWithoutViewer } from './billingPolicy.js';
import { probeRemoteTrameActivity } from './remoteActivity.js';

/** @type {Map<number, { type: 'provision'|'destroy', abort: AbortController, promise: Promise<void> }>} */
const activeJobs = new Map();

export function touchProjectBillingActivity(projectId) {
    if (!projectId) return;
    ProjectGpu.touchBillingActivity(projectId);
}

/**
 * Stop remote GPU billing when viewer is gone and idle/wall limits are exceeded.
 * @returns {Promise<{ stopped: boolean, reason?: string, remoteActivity?: object }>}
 */
export async function evaluateRemoteBillingStop(projectId, { viewerActive, nowMs = Date.now() } = {}) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) {
        return { stopped: false };
    }

    let remoteActivity = null;
    if (instance.trameServiceUrl) {
        remoteActivity = await probeRemoteTrameActivity(instance.trameServiceUrl);
    }

    const clientSaysNoViewer = viewerActive === false;
    const noRemoteSessions = !remoteActivity?.hasActiveSession;
    const trameUnreachable = Boolean(remoteActivity?.unreachable);

    // Do not tear down billing when trame is temporarily unreachable — only trust "no sessions" when probed.
    if (
        !trameUnreachable
        && (clientSaysNoViewer || noRemoteSessions)
        && shouldStopBillingWithoutViewer(instance, nowMs)
    ) {
        const autoReason = clientSaysNoViewer ? 'viewer_idle' : 'no_viewer_session';
        await stopBilling({ projectId, reason: autoReason });
        return {
            stopped: true,
            reason: autoReason,
            remoteActivity
        };
    }

    const reason = shouldAutoStopBilling(instance, nowMs);
    if (reason) {
        await stopBilling({ projectId, reason });
        return { stopped: true, reason, remoteActivity };
    }

    return { stopped: false, remoteActivity };
}

export function isJobActive(projectId) {
    return activeJobs.has(projectId);
}

function clearJobIfCurrent(projectId, type, promise) {
    const current = activeJobs.get(projectId);
    if (current?.type === type && current.promise === promise) {
        activeJobs.delete(projectId);
    }
}

function shouldSkipProvisionCompletion(projectId) {
    const status = ProjectGpu.getInstance(projectId)?.status;
    return status === 'stopping' || status === 'idle' || status === 'error';
}

/**
 * DELETE the remote provider instance (e.g. Vast contract). Retries once.
 * A stopped/exited instance can still bill until destroyed — never treat "stop" as enough.
 * @returns {Promise<{ destroyed: boolean, skipped?: boolean }>}
 */
export async function destroyRemoteGpuInstance(projectId, { reason } = {}) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!instance?.instanceId || instance.providerId === 'local') {
        return { destroyed: false, skipped: true };
    }

    const settings = ProjectGpu.getSettings(projectId);
    const provider = getProvider(settings.providerId);
    const credentials = ProjectGpu.getCredentials(projectId);

    const runDestroy = async () => {
        const current = ProjectGpu.getInstance(projectId);
        await provider.destroy({ credentials, instance: current });
    };

    const label = reason ? ` (${reason})` : '';
    try {
        await runDestroy();
        return { destroyed: true };
    } catch (firstErr) {
        console.warn(
            `GPU destroy failed for project ${projectId}${label}, retrying:`,
            firstErr.message || firstErr
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await runDestroy();
        return { destroyed: true };
    }
}

/**
 * Provision gave up while a remote instance may exist — destroy it, then record error.
 * Uses instanceId presence, not Vast log message patterns.
 */
export async function reportRemoteProvisionFailure({
    projectId,
    message,
    source = GPU_ERROR_SOURCES.APP
}) {
    const instance = ProjectGpu.getInstance(projectId);
    const safeMessage = message || 'Provision failed';

    if (!instance?.instanceId || instance.providerId === 'local') {
        ProjectGpu.setError(projectId, safeMessage, { source });
        return { destroyed: false };
    }

    try {
        await destroyRemoteGpuInstance(projectId, { reason: 'provision_failure' });
        await removeGpuViewerProxy();
        ProjectGpu.setExternallyStopped(projectId, formatGpuError(safeMessage, source));
        console.log(`GPU instance destroyed after provision failure for project ${projectId}`);
        return { destroyed: true };
    } catch (err) {
        console.error(`GPU destroy after provision failure for project ${projectId}:`, err.message || err);
        ProjectGpu.setError(projectId, safeMessage, { source });
        return { destroyed: false };
    }
}

export async function startBilling({ projectId, userId }) {
    const existing = activeJobs.get(projectId);
    if (existing?.type === 'destroy') {
        throw new ConflictError('GPU billing is stopping — try again shortly');
    }
    if (existing?.type === 'provision') {
        throw new ConflictError('GPU billing operation already in progress for this project');
    }

    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') {
        throw new Error('Select a remote GPU provider before starting billing');
    }
    const provider = getProvider(settings.providerId);

    const instance = ProjectGpu.getInstance(projectId);
    if (instance?.status === 'running') {
        return ProjectGpu.getInstance(projectId);
    }
    if (instance?.status === 'provisioning') {
        throw new ConflictError('GPU is already provisioning');
    }

    const credentials = ProjectGpu.getCredentials(projectId);
    ProjectGpu.setProvisioning({ projectId, providerId: settings.providerId, createdByUserId: userId });

    const abort = new AbortController();
    const jobPromise = (async () => {
        try {
            const result = await provider.provision({
                credentials,
                projectId,
                signal: abort.signal
            });
            if (abort.signal.aborted || shouldSkipProvisionCompletion(projectId)) {
                return;
            }
            ProjectGpu.setRunning(projectId, {
                instanceId: result.instanceId,
                gpuHost: result.gpuHost,
                sshHost: null,
                sshPort: null,
                trameApiPort: result.trameApiPort,
                viewerPort: result.viewerPort,
                trameServiceUrl: result.trameServiceUrl,
                viewerPublicBaseUrl: result.viewerPublicBaseUrl,
                metadata: result.metadata
            });
            if (result.viewerPublicBaseUrl) {
                await writeGpuViewerProxy(result.viewerPublicBaseUrl);
            }
            if (process.env.GPU_PRESTAGE_AUTO !== 'false') {
                prestageProjectFilesBackground({ projectId, userId });
            }
        } catch (err) {
            if (isBillingCancelledError(err) || abort.signal.aborted || shouldSkipProvisionCompletion(projectId)) {
                console.log(`GPU provision cancelled for project ${projectId}`);
                return;
            }
            console.error(`GPU provision failed for project ${projectId}:`, err);
            const settings = ProjectGpu.getSettings(projectId);
            const source = settings.providerId === 'vast'
                ? GPU_ERROR_SOURCES.VAST
                : GPU_ERROR_SOURCES.APP;
            let message = err.message || 'Provision failed';
            if (settings.providerId === 'vast' && isInvalidApiKeyError(err)) {
                message = 'Invalid user key — your stored API key may be corrupted. '
                    + 'Open GPU settings, paste your key from https://cloud.vast.ai/cli/, and save again.';
            }
            await reportRemoteProvisionFailure({ projectId, message, source });
        } finally {
            clearJobIfCurrent(projectId, 'provision', jobPromise);
        }
    })();

    activeJobs.set(projectId, { type: 'provision', abort, promise: jobPromise });
    return { status: 'provisioning' };
}

export async function stopBilling({ projectId, reason } = {}) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!instance || instance.status === 'idle') {
        return { status: 'idle' };
    }

    const existing = activeJobs.get(projectId);
    if (existing?.type === 'destroy') {
        return { status: 'stopping' };
    }

    if (existing?.type === 'provision') {
        existing.abort.abort();
    }

    ProjectGpu.setStopping(projectId);

    const jobPromise = (async () => {
        try {
            if (existing?.type === 'provision') {
                try {
                    await existing.promise;
                } catch {
                    // cancelled or failed — continue to destroy
                }
            }
            const hadRemote = Boolean(ProjectGpu.getInstance(projectId)?.instanceId);
            if (hadRemote) {
                await destroyRemoteGpuInstance(projectId, { reason: reason || 'manual_stop' });
                console.log(
                    `GPU instance destroyed for project ${projectId}${reason ? ` (${reason})` : ''}`
                );
            }
            ProjectGpu.setIdle(projectId);
            await removeGpuViewerProxy();
        } catch (err) {
            console.error(`GPU destroy failed for project ${projectId}:`, err);
            ProjectGpu.setError(projectId, err.message || 'Failed to destroy GPU instance', {
                source: GPU_ERROR_SOURCES.APP
            });
        } finally {
            clearJobIfCurrent(projectId, 'destroy', jobPromise);
        }
    })();

    activeJobs.set(projectId, { type: 'destroy', abort: new AbortController(), promise: jobPromise });
    return { status: 'stopping' };
}

/** User dismissed a GPU error — destroy remote instance if one exists, else clear local error. */
export async function acknowledgeGpuError({ projectId }) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!instance || instance.status === 'idle') {
        return { status: 'idle' };
    }

    if (instance.instanceId) {
        return stopBilling({ projectId });
    }

    if (instance.status === 'error') {
        ProjectGpu.clearError(projectId);
    }

    return { status: 'idle' };
}

export async function syncProjectFile({ projectId, file, launcherUserId }) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') return null;

    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) {
        throw new Error('Start GPU billing before opening files on a remote provider');
    }

    const provider = getProvider(settings.providerId);
    const storageKey = storage.normalizeKey(file.file_path);
    const { cacheKey, userId, fileName } = resolveSyncTarget(file, launcherUserId);
    let syncKey = storageKey;

    if (file.user_id !== launcherUserId) {
        const stagedKey = await storage.ensureStagedCopy({
            sourceKey: storageKey,
            userId,
            fileName
        });
        syncKey = stagedKey;
    }

    if (!(await storage.exists(syncKey))) {
        throw new Error('Scene file not found in storage for sync');
    }

    const { size: localBytes } = await storage.stat(syncKey);
    const cached = instance.metadata?.syncedFiles?.[cacheKey];
    if (cached?.bytes === localBytes) {
        console.log(`GPU sync skipped (cached): ${cacheKey} (${localBytes} bytes)`);
        return { status: 'skipped', bytes: localBytes };
    }

    const result = await provider.syncFile({
        instance,
        userId,
        storageKey: syncKey,
        fileName,
        localBytes
    });

    ProjectGpu.patchMetadata(projectId, (meta) => ({
        ...meta,
        syncedFiles: {
            ...(meta.syncedFiles || {}),
            [cacheKey]: { bytes: localBytes, syncedAt: new Date().toISOString() }
        }
    }));

    return result;
}

/**
 * Remote GPU projects must have active billing before opening files.
 * @throws {ConflictError}
 */
export function assertProjectGpuReadyForFileOpen({ projectId, userId }) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') return;

    const instance = ProjectGpu.getInstance(projectId);
    if (ProjectGpu.isRemoteRunning(instance)) return;

    const project = Project.findForUser({ projectId, userId });
    const isAdmin = project?.userRole === 'admin';
    const status = instance?.status || 'idle';

    let message;
    if (status === 'provisioning') {
        message = 'GPU is still starting. Wait until it is ready, then try again.';
    } else if (status === 'stopping') {
        message = 'GPU is shutting down. Try again in a moment.';
    } else if (status === 'error') {
        message = instance?.errorMessage
            || 'GPU billing is unavailable. Start billing again or contact the project admin.';
    } else if (!isAdmin) {
        message = 'GPU billing is not running. Ask the project admin to start billing before opening files.';
    } else {
        message = 'Start GPU billing on this project before opening files.';
    }
    throw new ConflictError(message);
}

export function getTrameContextForProject(projectId) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') return null;

    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) return null;

    return {
        projectId,
        providerId: settings.providerId,
        trameServiceUrl: instance.trameServiceUrl,
        viewerPublicBaseUrl: instance.viewerPublicBaseUrl,
        runtime: 'process'
    };
}

export async function ensureGpuViewerProxyForProject(projectId) {
    const instance = ProjectGpu.getInstance(projectId);
    if (ProjectGpu.isRemoteRunning(instance) && instance.viewerPublicBaseUrl) {
        await writeGpuViewerProxy(instance.viewerPublicBaseUrl);
    }
}

export { restoreGpuViewerProxies };
