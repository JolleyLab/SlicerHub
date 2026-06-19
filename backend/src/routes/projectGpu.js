import fs from 'fs';
import path from 'path';
import Project from '../models/Project.js';
import ProjectGpu from '../models/ProjectGpu.js';
import File from '../models/File.js';
import storage from '../storage/index.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError } from '../utils/errors.js';
import { buildViewerFrontendUrl } from '../utils/viewerUrl.js';
import { listProviders, getProvider } from '../gpu/registry.js';
import { startBilling, stopBilling, touchProjectBillingActivity, acknowledgeGpuError, evaluateRemoteBillingStop, reportRemoteProvisionFailure } from '../gpu/orchestrator.js';
import { computeBillingLease } from '../gpu/billingPolicy.js';
import { prestageProjectFiles, isPrestageActive } from '../gpu/prestage.js';
import { reconcileProjectGpu } from '../gpu/reconcile.js';
import { isFileStaged } from '../gpu/syncKeys.js';
import { maskSecret } from '../gpu/credentials.js';
import { parseGpuError, GPU_ERROR_SOURCES } from '../gpu/errors.js';
import { verifyVastApiKey } from '../gpu/providers/vast/client.js';

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
        updatedAt: settings.updatedAt,
        configuredProviders: buildConfiguredProviders(projectId)
    };
}

function slicerGuiDataDir() {
    return path.join(process.cwd(), 'data', 'slicer-gui');
}

function defaultSlicerGuiViewerPath() {
    const fromEnv = (process.env.LOCAL_SLICER_GUI_PATH || '').trim();
    if (fromEnv) return fromEnv;
    return '/slicer-gui/vnc.html?autoconnect=true&resize=scale';
}

async function stageProjectFileForSlicerGui({ file, launcherUserId }) {
    if (!(await storage.exists(file.file_path))) {
        throw new ValidationError('File not found on server');
    }

    const safeName = path.basename(file.original_name || file.file_path);
    const destDir = slicerGuiDataDir();
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, safeName);

    let sourceKey = file.file_path;
    if (file.user_id !== Number(launcherUserId) && String(file.user_id) !== launcherUserId) {
        const sharedName = `shared-${file.id}-${safeName}`;
        sourceKey = await storage.ensureStagedCopy({
            sourceKey: file.file_path,
            userId: launcherUserId,
            fileName: sharedName
        });
    }

    const srcPath = storage.resolvePath(sourceKey);
    fs.copyFileSync(srcPath, destPath);
    try {
        fs.chmodSync(destPath, 0o666);
    } catch {
        /* best effort for cross-container read on shared mount */
    }
    try {
        const fd = fs.openSync(destPath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
    } catch {
        /* fsync optional */
    }

    const containerPath = `/home/slicer/data/${safeName}`;
    const requestFile = path.join(destDir, '.open-request.json');
    const requestPayload = {
        fileName: safeName,
        containerPath,
        requestedAt: new Date().toISOString()
    };
    fs.writeFileSync(`${requestFile}.tmp`, JSON.stringify(requestPayload, null, 2));
    fs.renameSync(`${requestFile}.tmp`, requestFile);
    try {
        fs.chmodSync(requestFile, 0o666);
    } catch {
        /* best effort */
    }

    console.log('Staged full-slicer file', {
        destPath,
        containerPath,
        bytes: fs.statSync(destPath).size
    });

    return {
        fileName: safeName,
        containerPath
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

export default function projectGpuRoutes(app) {
    app.get('/api/gpu/providers', authenticateToken, asyncHandler(async (_req, res) => {
        res.json({ providers: listProviders() });
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
            .filter((file) => isFileStaged(file, syncedFiles, req.user.id))
            .map((file) => file.id);

        res.json({
            settings: publicGpuSettings(projectId),
            instance: publicInst,
            billingLease: computeBillingLease(instance),
            canManage: project.userRole === 'admin',
            prestageActive: isPrestageActive(projectId),
            stagedFileIds,
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

        const reconcile = await reconcileProjectGpu(projectId, { force: true });
        const current = reconcile.instance || ProjectGpu.getInstance(projectId);
        if (!ProjectGpu.isRemoteRunning(current)) {
            return res.json({
                success: true,
                status: current?.status || 'idle',
                billingStopped: true,
                reason: reconcile.reason || current?.errorMessage || null,
                instance: publicInstance(current),
                remoteActivity: reconcile.remoteActivity || null
            });
        }

        const viewerActive = req.body?.viewerActive === true;
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
                    remoteActivity: stopResult.remoteActivity || null
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
                    setAsDefault: req.body?.setAsDefault === true,
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
        } else if (req.body?.useFullSlicer !== undefined) {
            try {
                ProjectGpu.setLocalOptions({
                    projectId,
                    useFullSlicer: req.body.useFullSlicer === true,
                    updatedByUserId: req.user.id
                });
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
        requireProjectAdmin(projectId, req.user.id);

        const result = await startBilling({ projectId, userId: req.user.id });
        const instance = ProjectGpu.getInstance(projectId);
        res.json({ ...result, instance: publicInstance(instance) });
    }));

    app.post('/api/projects/:projectId/gpu/stop', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAdmin(projectId, req.user.id);

        const result = await stopBilling({ projectId });
        const instance = ProjectGpu.getInstance(projectId);
        res.json({ ...result, instance: publicInstance(instance) });
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

        const settings = ProjectGpu.getSettings(projectId);
        if (settings.providerId !== 'local' || settings.useFullSlicer !== true) {
            throw new ValidationError('Full Slicer viewer is not enabled for this project');
        }

        const fileId = Number(req.body?.fileId);
        if (!Number.isInteger(fileId) || fileId <= 0) {
            throw new ValidationError('fileId is required');
        }

        const file = File.findById(fileId);
        const projectRole = Project.findForUser({ projectId, userId: req.user.id })?.userRole;
        const canAccess = !!file && (
            file.project_id === projectId
            || file.user_id === req.user.id
            || projectRole === 'admin'
            || projectRole === 'collaborator'
            || projectRole === 'observer'
        );
        if (!canAccess) {
            throw new ValidationError('File not found or inaccessible');
        }

        const staged = await stageProjectFileForSlicerGui({
            file,
            launcherUserId: String(req.user.id)
        });
        File.touchLastViewed(file.id);

        const viewerPath = defaultSlicerGuiViewerPath();
        const frontendUrl = buildViewerFrontendUrl(req, req.user.id.toString(), null, null);
        const origin = frontendUrl ? new URL(frontendUrl).origin : `${req.protocol}://${req.get('host')}`;
        const slicerGuiUrl = `${origin}${viewerPath.startsWith('/') ? viewerPath : `/${viewerPath}`}`;

        res.json({
            slicerGuiUrl,
            fileName: staged.fileName,
            containerPath: staged.containerPath
        });
    }));

    app.post('/api/projects/:projectId/gpu/prestage', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = parseProjectId(req.params.projectId);
        requireProjectAccess(projectId, req.user.id);

        const fileIds = Array.isArray(req.body?.fileIds)
            ? req.body.fileIds.map((id) => Number(id)).filter((id) => id > 0)
            : null;

        const result = await prestageProjectFiles({
            projectId,
            userId: req.user.id,
            fileIds: fileIds?.length ? fileIds : null
        });

        const instance = ProjectGpu.getInstance(projectId);
        res.json({
            ...result,
            instance: publicInstance(instance),
            stagedFileIds: File.findByProjectId(projectId)
                .filter((file) => isFileStaged(file, instance?.metadata?.syncedFiles || {}, req.user.id))
                .map((file) => file.id)
        });
    }));
}
