import Docker from 'dockerode';
import http from 'http';
import {
    ensureSlicerGuiUserDir,
    hostBindPathForSlicerGuiDir,
    slicerGuiContainerName,
    safeSlicerGuiUserId
} from './paths.js';
import {
    beginSession,
    createSessionToken,
    clearSession,
    endSession,
    touchSession
} from '../sessions/leaseRegistry.js';
import { SESSION_KINDS } from '../sessions/kinds.js';
import { stopSlicerGuiContainer, listPerUserSlicerGuiContainers as listSlicerGuiContainers } from '../sessions/providers/slicerGui.js';

const SLICER_GUI = SESSION_KINDS.SLICER_GUI;

const docker = new Docker({
    socketPath: process.env.DOCKER_HOST?.replace('unix://', '') || '/var/run/docker.sock'
});

const NETWORK = process.env.SLICER_GUI_NETWORK || 'trame-net';
const IMAGE = process.env.SLICER_GUI_IMAGE || 'slicer-web-slicer-gui:local';
const READY_TIMEOUT_MS = Number(process.env.SLICER_GUI_READY_TIMEOUT_MS || 180000);
const REUSE_READY_TIMEOUT_MS = Number(process.env.SLICER_GUI_REUSE_READY_TIMEOUT_MS || 15000);

async function isNoVncReady(containerName, timeoutMs = 2000) {
    try {
        await new Promise((resolve, reject) => {
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
        return true;
    } catch {
        return false;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNoVnc(containerName, timeoutMs = READY_TIMEOUT_MS, { touchLease } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        if (touchLease) {
            touchLease();
        }
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(
                    {
                        host: containerName,
                        port: 6080,
                        path: '/vnc.html',
                        timeout: 2000
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
            return;
        } catch (err) {
            lastError = err.message || String(err);
            await sleep(1000);
        }
    }
    throw new Error(`Full Slicer session not ready (${containerName}): ${lastError}`);
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

export { listSlicerGuiContainers as listPerUserSlicerGuiContainers };

export async function stopAllPerUserSlicerGuiSessions() {
    const { stopAllPerUserSlicerGuiContainers } = await import('../sessions/providers/slicerGui.js');
    return stopAllPerUserSlicerGuiContainers();
}

/**
 * Ensure a per-user local Full Slicer container is running.
 * Local-only Phase A: one container per userId on trame-net.
 */
export async function ensureSlicerGuiSession({
    userId,
    sessionToken = null,
    useSimplifiedViewer = null
}) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const containerName = slicerGuiContainerName(safeUserId);
    const dataDir = ensureSlicerGuiUserDir(safeUserId);
    const token = sessionToken || createSessionToken();

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
                const existingMode = existingLease?.metadata?.useSimplifiedViewer;
                const desiredMode = useSimplifiedViewer === null
                    ? null
                    : useSimplifiedViewer === true;
                if (desiredMode !== null && existingMode !== desiredMode) {
                    console.log(
                        `Full Slicer mode changed for ${containerName} `
                        + `(from ${existingMode === true ? 'simplified' : 'full'} `
                        + `to ${desiredMode ? 'simplified' : 'full'}) — recreating`
                    );
                    clearSession(SLICER_GUI, safeUserId);
                    await existing.remove({ force: true });
                    vncReady = false;
                }
            }
            if (vncReady) {
                console.log(`Reusing Full Slicer session ${containerName}`);
                const lease = beginSession(SLICER_GUI, safeUserId, {
                    sessionToken: token,
                    metadata: {
                        containerName,
                        useSimplifiedViewer: useSimplifiedViewer === true
                    }
                });
                return {
                    containerName,
                    containerId: info.Id,
                    userId: safeUserId,
                    dataDir,
                    sessionToken: lease.sessionToken,
                    reused: true
                };
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

    const hostDataDir = hostBindPathForSlicerGuiDir(dataDir);
    const binds = [
        `${hostDataDir}:/home/slicer/data`,
        '/dev/shm:/dev/shm'
    ];

    const hostWorkspace = (process.env.HOST_WORKSPACE_ROOT || '').trim().replace(/\\/g, '/');
    const toDockerBind = (p) => {
        let hostPath = String(p || '').replace(/\\/g, '/');
        if (/^[A-Za-z]:\//.test(hostPath)) {
            const drive = hostPath[0].toLowerCase();
            hostPath = `/${drive}${hostPath.slice(2)}`;
        }
        return hostPath;
    };

    // Local/dev: mount SimplifiedViewer + session scripts from the host when configured.
    const simplifiedLocal = (process.env.SLICER_HEART_VIEWER_LOCAL_PATH || '').trim();
    if (simplifiedLocal) {
        binds.push(`${toDockerBind(simplifiedLocal)}:/opt/slicer-modules/SimplifiedViewer:ro`);
    }
    if (hostWorkspace) {
        const scripts = [
            ['slicer-gui-gpu/launch-slicer.sh', '/usr/local/bin/launch-slicer.sh'],
            ['slicer-gui-gpu/slicer_session.py', '/usr/local/bin/slicer_session.py'],
            ['slicer-gui-gpu/install-slicer-extensions.py', '/usr/local/bin/install-slicer-extensions.py']
        ];
        for (const [rel, dest] of scripts) {
            binds.push(`${toDockerBind(`${hostWorkspace.replace(/\/$/, '')}/${rel}`)}:${dest}:ro`);
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

    // Register lease before noVNC is ready so the watchdog does not treat this as orphaned.
    const lease = beginSession(SLICER_GUI, safeUserId, {
        sessionToken: token,
        metadata: {
            containerName,
            starting: true,
            useSimplifiedViewer: useSimplifiedViewer === true
        }
    });

    try {
        await waitForNoVnc(containerName, READY_TIMEOUT_MS, {
            touchLease: () => touchSession(SLICER_GUI, safeUserId, token)
        });
    } catch (err) {
        clearSession(SLICER_GUI, safeUserId);
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
        reused: false
    };
}

export function touchSlicerGuiSessionHeartbeat({ userId, sessionToken }) {
    return touchSession(SLICER_GUI, userId, sessionToken);
}

export async function releaseSlicerGuiSession({ userId, sessionToken }) {
    const safeUserId = safeSlicerGuiUserId(userId);
    if (!endSession(SLICER_GUI, safeUserId, sessionToken)) {
        return { stopped: false, reason: 'stale-session' };
    }
    await stopSlicerGuiContainer({ sessionKey: safeUserId });
    return { stopped: true, containerName: slicerGuiContainerName(safeUserId) };
}

export async function stopSlicerGuiSession({ userId }) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const containerName = slicerGuiContainerName(safeUserId);
    clearSession(SLICER_GUI, safeUserId);
    await stopSlicerGuiContainer({ sessionKey: safeUserId });
    return { stopped: true, containerName };
}
