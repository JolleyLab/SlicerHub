import ProjectGpu from '../models/ProjectGpu.js';
import { getProvider } from './registry.js';
import { removeGpuViewerProxy } from './gpuViewerProxy.js';
import { probeRemoteTrameActivity } from './remoteActivity.js';
import { formatGpuError, GPU_ERROR_SOURCES } from './errors.js';
import { destroyRemoteGpuInstance } from './orchestrator.js';

const reconcileThrottle = new Map();
const RECONCILE_MIN_MS = 25_000;

/**
 * Compare app DB state with the remote provider (e.g. Vast console delete).
 * @returns {{ instance: object|null, changed: boolean, reason?: string }}
 */
export async function reconcileProjectGpu(projectId, { force = false } = {}) {
    const settings = ProjectGpu.getSettings(projectId);
    if (settings.providerId === 'local') {
        return { instance: ProjectGpu.getInstance(projectId), changed: false };
    }

    let instance = ProjectGpu.getInstance(projectId);
    const activeStatuses = new Set(['running', 'provisioning', 'stopping', 'error']);

    // Early provision — contract id not assigned yet; nothing to check on the provider.
    if (instance?.status === 'provisioning' && !instance?.instanceId) {
        return { instance, changed: false };
    }

    if (!instance?.instanceId) {
        if (instance?.status === 'stopping' || instance?.status === 'provisioning') {
            return { instance, changed: false };
        }
        if (activeStatuses.has(instance?.status) && instance?.status !== 'error') {
            const reason = formatGpuError(
                'GPU instance is no longer available on the provider',
                settings.providerId === 'vast' ? GPU_ERROR_SOURCES.VAST : GPU_ERROR_SOURCES.APP
            );
            ProjectGpu.setExternallyStopped(projectId, reason);
            await removeGpuViewerProxy();
            return {
                instance: ProjectGpu.getInstance(projectId),
                changed: true,
                reason
            };
        }
        return { instance, changed: false };
    }

    if (!activeStatuses.has(instance.status)) {
        return { instance, changed: false };
    }

    const now = Date.now();
    const last = reconcileThrottle.get(projectId) || 0;
    if (!force && now - last < RECONCILE_MIN_MS) {
        return { instance, changed: false };
    }
    reconcileThrottle.set(projectId, now);

    const provider = getProvider(settings.providerId);
    if (typeof provider.checkInstance !== 'function') {
        return { instance, changed: false };
    }

    let credentials;
    try {
        credentials = ProjectGpu.getCredentials(projectId);
    } catch (err) {
        console.warn(`GPU reconcile skipped for project ${projectId}: ${err.message}`);
        return { instance, changed: false };
    }

    try {
        const check = await provider.checkInstance({ credentials, instance });
        if (check.alive) {
            let remoteActivity = null;
            if (instance.status === 'running' && instance.trameServiceUrl) {
                remoteActivity = await probeRemoteTrameActivity(instance.trameServiceUrl);
            }
            return { instance: ProjectGpu.getInstance(projectId), changed: false, remoteActivity };
        }

        const rawReason = check.reason || 'GPU instance is no longer available on the provider';
        const reason = formatGpuError(
            rawReason,
            settings.providerId === 'vast' ? GPU_ERROR_SOURCES.VAST : GPU_ERROR_SOURCES.APP
        );
        console.warn(`Project ${projectId} remote GPU gone: ${reason}`);
        // Stopped/exited on Vast can still bill until DELETE — destroy if the contract still exists.
        try {
            await destroyRemoteGpuInstance(projectId, { reason: 'reconcile_gone' });
        } catch (err) {
            console.warn(`GPU destroy during reconcile for project ${projectId}:`, err.message || err);
        }
        ProjectGpu.setExternallyStopped(projectId, reason);
        await removeGpuViewerProxy();
        reconcileThrottle.delete(projectId);
        return {
            instance: ProjectGpu.getInstance(projectId),
            changed: true,
            reason
        };
    } catch (err) {
        console.warn(`GPU reconcile check failed for project ${projectId}:`, err.message);
        return { instance, changed: false };
    }
}

export async function reconcileAllActiveRemote() {
    const active = ProjectGpu.listActiveRemote();
    for (const row of active) {
        try {
            await reconcileProjectGpu(row.projectId);
        } catch (err) {
            console.warn(`GPU reconcile failed for project ${row.projectId}:`, err.message);
        }
    }
}
