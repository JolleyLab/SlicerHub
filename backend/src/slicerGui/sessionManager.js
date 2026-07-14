import Docker from 'dockerode';
import http from 'http';
import {
    ensureSlicerGuiUserDir,
    hostBindPathForSlicerGuiDir,
    toDockerBindPath,
    slicerGuiContainerName,
    safeSlicerGuiUserId,
    readLastLoadedFile,
    clearLastLoadedFile,
    clearSlicerReadyFile,
    readSlicerReadyFile
} from './paths.js';
import { clearSlicerGuiPendingOpen } from './stageFile.js';
import {
    beginSession,
    createSessionToken,
    clearSession,
    getSession,
    touchSession
} from '../sessions/leaseRegistry.js';
import { SESSION_KINDS } from '../sessions/kinds.js';
import {
    releaseViewerSession,
    VIEWER_RELEASE_MODES
} from '../sessions/lifecycle.js';
import { stopSlicerGuiContainer } from '../sessions/providers/slicerGui.js';

const SLICER_GUI = SESSION_KINDS.SLICER_GUI;

const docker = new Docker({
    socketPath: process.env.DOCKER_HOST?.replace('unix://', '') || '/var/run/docker.sock'
});

const NETWORK = process.env.SLICER_GUI_NETWORK || 'trame-net';
const IMAGE = process.env.SLICER_GUI_IMAGE || 'slicer-web-slicer-gui:local';
const READY_TIMEOUT_MS = Number(process.env.SLICER_GUI_READY_TIMEOUT_MS || 180000);
const REUSE_READY_TIMEOUT_MS = Number(process.env.SLICER_GUI_REUSE_READY_TIMEOUT_MS || 15000);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeNoVnc(containerName, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const req = http.get(
            {
                host: containerName,
                port: 6080,
                path: '/vnc.html',
                timeout: timeoutMs
            },
            (res) => {
                res.resume();
                if (res.statusCode && res.statusCode < 500) {
                    resolve();
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

async function isNoVncReady(containerName, timeoutMs = 2000) {
    try {
        await probeNoVnc(containerName, timeoutMs);
        return true;
    } catch {
        return false;
    }
}

async function waitForNoVnc(containerName, timeoutMs = READY_TIMEOUT_MS, { touchLease } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        if (touchLease) {
            touchLease();
        }
        try {
            await probeNoVnc(containerName, 2000);
            return;
        } catch (err) {
            lastError = err.message || String(err);
            await sleep(1000);
        }
    }
    throw new Error(`Full Slicer session not ready (${containerName}): ${lastError}`);
}

async function waitForSlicerSessionReady(userId, timeoutMs = READY_TIMEOUT_MS, { touchLease } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (touchLease) {
            touchLease();
        }
        if (readSlicerReadyFile(userId)) {
            return;
        }
        await sleep(400);
    }
    throw new Error(`Full Slicer UI not ready yet (user ${userId})`);
}

async function removeIfExists(containerName) {
    try {
        const container = docker.getContainer(containerName);
        await container.remove({ force: true });
    } catch (err) {
        if (err.statusCode !== 404) {
            throw err;
        }
    }
}

function resolveSceneLoaded(priorMeta, persisted) {
    if (persisted?.sceneLoaded === true || priorMeta.sceneLoaded === true) {
        return true;
    }
    if (priorMeta.sceneLoaded === false || persisted?.sceneLoaded === false) {
        return false;
    }
    // Legacy marker without sceneLoaded — readLastLoadedFile already treats as true.
    return persisted != null && persisted.fileId != null;
}

/** Ensure a per-user local Full Slicer container is running on trame-net. */
export async function ensureSlicerGuiSession({
    userId,
    sessionToken = null,
    useSimplifiedViewer = null
}) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const containerName = slicerGuiContainerName(safeUserId);
    const dataDir = ensureSlicerGuiUserDir(safeUserId);
    const token = sessionToken || createSessionToken();
    clearSlicerGuiPendingOpen(safeUserId);

    try {
        const existing = docker.getContainer(containerName);
        const info = await existing.inspect();
        if (info.State?.Running) {
            let vncReady = await isNoVncReady(containerName, 3000);
            if (!vncReady) {
                try {
                    await waitForNoVnc(containerName, REUSE_READY_TIMEOUT_MS, {
                        touchLease: () => touchSession(SLICER_GUI, safeUserId, token)
                    });
                    vncReady = true;
                } catch {
                    vncReady = false;
                }
            }
            if (vncReady) {
                const existingLease = getSession(SLICER_GUI, safeUserId);
                const existingMode = existingLease?.metadata?.useSimplifiedViewer === true;
                const desiredMode = useSimplifiedViewer == null
                    ? null
                    : useSimplifiedViewer === true;
                if (desiredMode !== null && existingMode !== desiredMode) {
                    console.log(
                        `Full Slicer mode changed for ${containerName} `
                        + `(from ${existingMode ? 'simplified' : 'full'} `
                        + `to ${desiredMode ? 'simplified' : 'full'}) — recreating`
                    );
                    clearSession(SLICER_GUI, safeUserId);
                    await existing.remove({ force: true });
                    vncReady = false;
                } else if (!readSlicerReadyFile(safeUserId)) {
                    // VNC can answer before Slicer UI/poller is up.
                    try {
                        await waitForSlicerSessionReady(safeUserId, READY_TIMEOUT_MS, {
                            touchLease: () => touchSession(SLICER_GUI, safeUserId, token)
                        });
                    } catch {
                        console.log(
                            `Full Slicer ${containerName} VNC is up but Slicer UI is not ready — recreating`
                        );
                        clearSession(SLICER_GUI, safeUserId);
                        clearSlicerReadyFile(safeUserId);
                        await existing.remove({ force: true });
                        vncReady = false;
                    }
                }
                if (vncReady) {
                    console.log(`Reusing Full Slicer session ${containerName}`);
                    const priorMeta = existingLease?.metadata || {};
                    const persisted = readLastLoadedFile(safeUserId);
                    const lastLoadedFileId = priorMeta.lastLoadedFileId
                        ?? persisted?.fileId
                        ?? null;
                    const sceneLoaded = resolveSceneLoaded(priorMeta, persisted);
                    const lease = beginSession(SLICER_GUI, safeUserId, {
                        sessionToken: token,
                        metadata: {
                            ...priorMeta,
                            containerName,
                            useSimplifiedViewer: useSimplifiedViewer === true,
                            lastLoadedFileId,
                            sceneLoaded
                        }
                    });
                    return {
                        containerName,
                        containerId: info.Id,
                        userId: safeUserId,
                        dataDir,
                        sessionToken: lease.sessionToken,
                        reused: true,
                        lastLoadedFileId,
                        sceneLoaded
                    };
                }
            }
            console.log(`Full Slicer ${containerName} is running but VNC is not ready — recreating`);
            await existing.remove({ force: true });
        } else {
            console.log(`Removing stopped Full Slicer session ${containerName}`);
            await existing.remove({ force: true });
        }
    } catch (err) {
        if (err.statusCode !== 404) {
            throw err;
        }
    }

    clearSlicerReadyFile(safeUserId);

    const hostDataDir = hostBindPathForSlicerGuiDir(dataDir);
    const binds = [
        `${hostDataDir}:/home/slicer/data`,
        '/dev/shm:/dev/shm'
    ];

    const hostWorkspace = (process.env.HOST_WORKSPACE_ROOT || '').trim().replace(/\\/g, '/');
    const simplifiedLocal = (process.env.SLICER_HEART_VIEWER_LOCAL_PATH || '').trim();
    if (simplifiedLocal) {
        binds.push(`${toDockerBindPath(simplifiedLocal)}:/opt/slicer-modules/SimplifiedViewer:ro`);
    }
    if (hostWorkspace) {
        const scripts = [
            ['slicer-gui-gpu/launch-slicer.sh', '/usr/local/bin/launch-slicer.sh'],
            ['slicer-gui-gpu/slicer_session.py', '/usr/local/bin/slicer_session.py'],
            ['slicer-gui-gpu/install-slicer-extensions.py', '/usr/local/bin/install-slicer-extensions.py']
        ];
        for (const [rel, dest] of scripts) {
            binds.push(`${toDockerBindPath(`${hostWorkspace.replace(/\/$/, '')}/${rel}`)}:${dest}:ro`);
        }
    }

    console.log(`Starting Full Slicer session ${containerName}`, {
        image: IMAGE,
        hostDataDir,
        network: NETWORK
    });

    const container = await docker.createContainer({
        Image: IMAGE,
        name: containerName,
        Env: [
            'NVIDIA_VISIBLE_DEVICES=all',
            'NVIDIA_DRIVER_CAPABILITIES=all',
            `VNC_ALLOW_NO_PASSWORD=${process.env.VNC_ALLOW_NO_PASSWORD || 'true'}`,
            `VNC_PASSWORD=${process.env.VNC_PASSWORD || ''}`,
            `DISPLAY_WIDTH=${process.env.SLICER_GUI_DISPLAY_WIDTH || '1920'}`,
            `DISPLAY_HEIGHT=${process.env.SLICER_GUI_DISPLAY_HEIGHT || '1080'}`,
            'SLICER_SIMPLIFIED_VIEWER_PATH=/opt/slicer-modules/SimplifiedViewer'
        ],
        Labels: {
            'slicer-gui-service': 'true',
            'slicer-gui-user': safeUserId
        },
        HostConfig: {
            Binds: binds,
            CapAdd: ['SYS_PTRACE'],
            ShmSize: 8 * 1024 * 1024 * 1024,
            DeviceRequests: [
                {
                    Count: -1,
                    Capabilities: [['gpu']]
                }
            ],
            Runtime: 'nvidia',
            AutoRemove: false
        },
        NetworkingConfig: {
            EndpointsConfig: {
                [NETWORK]: {}
            }
        },
        Tty: true,
        OpenStdin: true
    });

    try {
        await container.start();
    } catch (err) {
        await removeIfExists(containerName);
        throw err;
    }

    clearLastLoadedFile(safeUserId);

    // Register lease before noVNC is ready so the watchdog does not treat this as orphaned.
    const lease = beginSession(SLICER_GUI, safeUserId, {
        sessionToken: token,
        metadata: {
            containerName,
            starting: true,
            useSimplifiedViewer: useSimplifiedViewer === true,
            sceneLoaded: false,
            lastLoadedFileId: null
        }
    });

    try {
        await waitForNoVnc(containerName, READY_TIMEOUT_MS, {
            touchLease: () => touchSession(SLICER_GUI, safeUserId, token)
        });
        await waitForSlicerSessionReady(safeUserId, READY_TIMEOUT_MS, {
            touchLease: () => touchSession(SLICER_GUI, safeUserId, token)
        });
    } catch (err) {
        clearSession(SLICER_GUI, safeUserId);
        clearSlicerReadyFile(safeUserId);
        await removeIfExists(containerName);
        throw err;
    }

    const info = await container.inspect();
    return {
        containerName,
        containerId: info.Id,
        userId: safeUserId,
        dataDir,
        sessionToken: lease.sessionToken,
        reused: false,
        sceneLoaded: false,
        lastLoadedFileId: null
    };
}

export function touchSlicerGuiSessionHeartbeat({ userId, sessionToken }) {
    return touchSession(SLICER_GUI, userId, sessionToken);
}

/**
 * Release a Full Slicer seat.
 * @param {'soft'|'hard'} [mode='hard'] soft keeps the container warm for fast reopen.
 */
export async function releaseSlicerGuiSession({
    userId,
    sessionToken,
    mode = VIEWER_RELEASE_MODES.HARD
}) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const result = await releaseViewerSession(SLICER_GUI, safeUserId, sessionToken, { mode });
    if (result.parked || result.stopped) {
        clearSlicerGuiPendingOpen(safeUserId);
    }
    if (result.stopped) {
        clearLastLoadedFile(safeUserId);
    }
    return {
        ...result,
        containerName: slicerGuiContainerName(safeUserId)
    };
}

export async function stopSlicerGuiSession({ userId }) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const containerName = slicerGuiContainerName(safeUserId);
    clearSession(SLICER_GUI, safeUserId);
    clearSlicerGuiPendingOpen(safeUserId);
    clearLastLoadedFile(safeUserId);
    await stopSlicerGuiContainer({ sessionKey: safeUserId });
    return { stopped: true, parked: false, containerName };
}
