import Docker from 'dockerode';
import http from 'http';
import {
    ensureSlicerGuiUserDir,
    hostBindPathForSlicerGuiDir,
    toDockerBindPath,
    slicerGuiContainerName,
    slicerGuiContainerNameFromSessionKey,
    slicerGuiSessionKey,
    safeSlicerGuiUserId,
    parseSlicerGuiSessionKey,
    getSlicerGuiMaxSeatsPerUser,
    normalizeSlicerGuiSeatId,
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
    touchSession,
    touchSessionByToken,
    findSessionByToken,
    listSessionsForKind
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

async function getContainerExitInfo(containerName) {
    try {
        const info = await docker.getContainer(containerName).inspect();
        if (info.State?.Running) {
            return null;
        }
        return {
            exitCode: info.State?.ExitCode,
            error: info.State?.Error || '',
            oomKilled: info.State?.OOMKilled === true
        };
    } catch {
        return { exitCode: null, error: 'container missing', oomKilled: false };
    }
}

async function waitForNoVnc(containerName, timeoutMs = READY_TIMEOUT_MS, { touchLease } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        if (touchLease) {
            touchLease();
        }
        const exited = await getContainerExitInfo(containerName);
        if (exited) {
            const detail = [
                exited.exitCode != null ? `exit ${exited.exitCode}` : null,
                exited.oomKilled ? 'OOM' : null,
                exited.error || null
            ].filter(Boolean).join(', ');
            throw new Error(
                `Full Slicer container stopped before ready (${containerName}`
                + `${detail ? `: ${detail}` : ''}). `
                + 'Check `docker logs` for that container. Exit 126 usually means a '
                + 'non-executable host bind of launch-slicer.sh — unset '
                + 'SLICER_GUI_MOUNT_DEV_SCRIPTS (default off) or rebuild the image.'
            );
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

async function waitForSlicerSessionReady(userId, seatId, timeoutMs = READY_TIMEOUT_MS, { touchLease } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (touchLease) {
            touchLease();
        }
        if (readSlicerReadyFile(userId, seatId)) {
            return;
        }
        await sleep(400);
    }
    throw new Error(`Full Slicer UI not ready yet (user ${userId} seat ${seatId})`);
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
    return persisted != null && persisted.fileId != null;
}

function listUserSeatLeases(safeUserId) {
    return listSessionsForKind(SLICER_GUI).filter((item) => {
        try {
            return parseSlicerGuiSessionKey(item.sessionKey).userId === safeUserId;
        } catch {
            return false;
        }
    });
}

/**
 * Pick a seat for this open: preferred → parked+same file → parked → free → LRU attached.
 */
export function allocateSlicerGuiSeatId(safeUserId, {
    preferredSeatId = null,
    preferFileId = null
} = {}) {
    const max = getSlicerGuiMaxSeatsPerUser();
    if (preferredSeatId != null && preferredSeatId !== '') {
        return normalizeSlicerGuiSeatId(preferredSeatId, { max });
    }

    const leases = listUserSeatLeases(safeUserId);
    const bySeat = new Map();
    for (const lease of leases) {
        const { seatId } = parseSlicerGuiSessionKey(lease.sessionKey);
        bySeat.set(seatId, lease);
    }

    if (preferFileId != null) {
        const want = Number(preferFileId);
        for (let seat = 1; seat <= max; seat += 1) {
            const lease = bySeat.get(seat);
            if (!lease?.metadata?.parked) continue;
            const persisted = readLastLoadedFile(safeUserId, seat);
            if (Number(persisted?.fileId) === want) {
                return seat;
            }
        }
    }

    for (let seat = 1; seat <= max; seat += 1) {
        if (bySeat.get(seat)?.metadata?.parked) {
            return seat;
        }
    }

    for (let seat = 1; seat <= max; seat += 1) {
        if (!bySeat.has(seat)) {
            return seat;
        }
    }

    // All seats busy — supersede least-recently-heartbeated (kicks that browser only).
    const sorted = [...bySeat.entries()].sort(
        (a, b) => (a[1].lastHeartbeatAt || 0) - (b[1].lastHeartbeatAt || 0)
    );
    return sorted[0]?.[0] || 1;
}

async function startOrReuseSeat({
    safeUserId,
    seatId,
    token,
    useSimplifiedViewer,
    requireSlicerUiReady
}) {
    const sessionKey = slicerGuiSessionKey(safeUserId, seatId);
    const containerName = slicerGuiContainerName(safeUserId, seatId);
    const dataDir = ensureSlicerGuiUserDir(safeUserId, seatId);
    clearSlicerGuiPendingOpen(safeUserId, seatId);

    const touchExistingLease = () => {
        const prior = getSession(SLICER_GUI, sessionKey);
        if (!prior?.sessionToken) return null;
        return touchSession(SLICER_GUI, sessionKey, prior.sessionToken);
    };

    try {
        const existing = docker.getContainer(containerName);
        const info = await existing.inspect();
        if (info.State?.Running) {
            let vncReady = await isNoVncReady(containerName, 3000);
            if (!vncReady) {
                try {
                    await waitForNoVnc(containerName, REUSE_READY_TIMEOUT_MS, {
                        touchLease: touchExistingLease
                    });
                    vncReady = true;
                } catch {
                    vncReady = false;
                }
            }
            if (vncReady) {
                const existingLease = getSession(SLICER_GUI, sessionKey);
                const persistedForMode = readLastLoadedFile(safeUserId, seatId);
                const existingMode = existingLease?.metadata?.useSimplifiedViewer === true
                    || persistedForMode?.useSimplifiedViewer === true;
                const desiredMode = useSimplifiedViewer == null
                    ? null
                    : useSimplifiedViewer === true;
                // Do not recreate on mode mismatch — that kills the warm scene.
                // Open path re-applies Simplified/Full chrome (skipLoad or restage).
                if (desiredMode !== null && existingMode !== desiredMode) {
                    console.log(
                        `Full Slicer mode mismatch for ${containerName} `
                        + `(seat ${existingMode ? 'simplified' : 'full'}, `
                        + `wanted ${desiredMode ? 'simplified' : 'full'}) — `
                        + 'reusing seat; mode will be applied on open'
                    );
                }
                if (!readSlicerReadyFile(safeUserId, seatId)) {
                    try {
                        await waitForSlicerSessionReady(safeUserId, seatId, READY_TIMEOUT_MS, {
                            touchLease: touchExistingLease
                        });
                    } catch {
                        if (!requireSlicerUiReady) {
                            console.log(
                                `Full Slicer ${containerName} VNC is up; UI not ready yet — `
                                + 'continuing (open request will wait for UI)'
                            );
                        } else {
                            console.log(
                                `Full Slicer ${containerName} VNC is up but Slicer UI is not ready — recreating`
                            );
                            clearSession(SLICER_GUI, sessionKey);
                            clearSlicerReadyFile(safeUserId, seatId);
                            await existing.remove({ force: true });
                            vncReady = false;
                        }
                    }
                }
                if (vncReady) {
                    console.log(`Reusing Full Slicer session ${containerName}`);
                    const priorMeta = existingLease?.metadata || {};
                    const persisted = readLastLoadedFile(safeUserId, seatId);
                    const lastLoadedFileId = priorMeta.lastLoadedFileId
                        ?? persisted?.fileId
                        ?? null;
                    const sceneLoaded = resolveSceneLoaded(priorMeta, persisted);
                    const priorUseSimplifiedViewer = priorMeta.useSimplifiedViewer === true
                        || persisted?.useSimplifiedViewer === true;
                    const lease = beginSession(SLICER_GUI, sessionKey, {
                        sessionToken: token,
                        metadata: {
                            ...priorMeta,
                            containerName,
                            userId: safeUserId,
                            seatId,
                            useSimplifiedViewer: useSimplifiedViewer === true,
                            lastLoadedFileId,
                            sceneLoaded
                        }
                    });
                    return {
                        containerName,
                        containerId: info.Id,
                        userId: safeUserId,
                        seatId,
                        sessionKey,
                        dataDir,
                        sessionToken: lease.sessionToken,
                        reused: true,
                        lastLoadedFileId,
                        sceneLoaded,
                        useSimplifiedViewer: useSimplifiedViewer === true,
                        priorUseSimplifiedViewer,
                        maxSeats: getSlicerGuiMaxSeatsPerUser()
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

    clearSlicerReadyFile(safeUserId, seatId);

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
    const mountDevScripts = /^(1|true|yes)$/i.test(
        String(process.env.SLICER_GUI_MOUNT_DEV_SCRIPTS || '').trim()
    );
    if (hostWorkspace && mountDevScripts) {
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
        network: NETWORK,
        seatId
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
            'slicer-gui-user': safeUserId,
            'slicer-gui-seat': String(seatId)
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

    clearLastLoadedFile(safeUserId, seatId);

    const lease = beginSession(SLICER_GUI, sessionKey, {
        sessionToken: token,
        metadata: {
            containerName,
            userId: safeUserId,
            seatId,
            starting: true,
            useSimplifiedViewer: useSimplifiedViewer === true,
            sceneLoaded: false,
            lastLoadedFileId: null
        }
    });

    try {
        await waitForNoVnc(containerName, READY_TIMEOUT_MS, {
            touchLease: () => touchSession(SLICER_GUI, sessionKey, token)
        });
        if (requireSlicerUiReady) {
            await waitForSlicerSessionReady(safeUserId, seatId, READY_TIMEOUT_MS, {
                touchLease: () => touchSession(SLICER_GUI, sessionKey, token)
            });
        } else {
            try {
                await waitForSlicerSessionReady(safeUserId, seatId, 20000, {
                    touchLease: () => touchSession(SLICER_GUI, sessionKey, token)
                });
            } catch {
                console.warn(
                    `Full Slicer UI not ready yet for ${containerName}; `
                    + 'returning VNC seat and letting open-request wait'
                );
            }
        }
    } catch (err) {
        clearSession(SLICER_GUI, sessionKey);
        clearSlicerReadyFile(safeUserId, seatId);
        await removeIfExists(containerName);
        throw err;
    }

    const info = await container.inspect();
    return {
        containerName,
        containerId: info.Id,
        userId: safeUserId,
        seatId,
        sessionKey,
        dataDir,
        sessionToken: lease.sessionToken,
        reused: false,
        sceneLoaded: false,
        lastLoadedFileId: null,
        maxSeats: getSlicerGuiMaxSeatsPerUser()
    };
}

/** Ensure a per-user seat container is running on trame-net. */
export async function ensureSlicerGuiSession({
    userId,
    seatId = null,
    preferFileId = null,
    useSimplifiedViewer = null,
    requireSlicerUiReady = true
} = {}) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const resolvedSeatId = allocateSlicerGuiSeatId(safeUserId, {
        preferredSeatId: seatId,
        preferFileId
    });
    const token = createSessionToken();
    return startOrReuseSeat({
        safeUserId,
        seatId: resolvedSeatId,
        token,
        useSimplifiedViewer,
        requireSlicerUiReady
    });
}

export function touchSlicerGuiSessionHeartbeat({ userId, sessionToken, seatId = null }) {
    if (sessionToken) {
        const byToken = touchSessionByToken(SLICER_GUI, sessionToken);
        if (byToken) return byToken;
    }
    if (userId != null && seatId != null) {
        return touchSession(
            SLICER_GUI,
            slicerGuiSessionKey(userId, seatId),
            sessionToken
        );
    }
    if (userId != null) {
        // Legacy single-seat heartbeat.
        return touchSession(SLICER_GUI, safeSlicerGuiUserId(userId), sessionToken);
    }
    return null;
}

/**
 * Release a Full Slicer seat.
 * @param {'soft'|'hard'} [mode='hard'] soft keeps the container warm for fast reopen.
 */
export async function releaseSlicerGuiSession({
    userId,
    sessionToken,
    seatId = null,
    mode = VIEWER_RELEASE_MODES.HARD
}) {
    let sessionKey = null;
    if (sessionToken) {
        sessionKey = findSessionByToken(SLICER_GUI, sessionToken)?.sessionKey || null;
    }
    if (!sessionKey && userId != null) {
        const seat = seatId != null ? seatId : 1;
        sessionKey = slicerGuiSessionKey(userId, seat);
    }
    if (!sessionKey) {
        return { stopped: false, parked: false, reason: 'not_found' };
    }

    const parsed = parseSlicerGuiSessionKey(sessionKey);
    const result = await releaseViewerSession(SLICER_GUI, sessionKey, sessionToken, { mode });
    if (result.parked || result.stopped) {
        clearSlicerGuiPendingOpen(parsed.userId, parsed.seatId);
    }
    if (result.stopped) {
        clearLastLoadedFile(parsed.userId, parsed.seatId);
    }
    return {
        ...result,
        seatId: parsed.seatId,
        sessionKey,
        containerName: slicerGuiContainerNameFromSessionKey(sessionKey)
    };
}

export async function stopSlicerGuiSession({ userId, seatId = null }) {
    const safeUserId = safeSlicerGuiUserId(userId);
    const max = getSlicerGuiMaxSeatsPerUser();
    const seats = seatId != null
        ? [normalizeSlicerGuiSeatId(seatId, { max })]
        : Array.from({ length: max }, (_, i) => i + 1);

    const stopped = [];
    for (const seat of seats) {
        const sessionKey = slicerGuiSessionKey(safeUserId, seat);
        clearSession(SLICER_GUI, sessionKey);
        clearSlicerGuiPendingOpen(safeUserId, seat);
        clearLastLoadedFile(safeUserId, seat);
        await stopSlicerGuiContainer({ sessionKey });
        stopped.push(seat);
    }
    // Also remove legacy single-seat container if present.
    if (seatId == null) {
        clearSession(SLICER_GUI, safeUserId);
        await stopSlicerGuiContainer({ sessionKey: safeUserId });
    }
    return { stopped: true, parked: false, seats: stopped };
}
