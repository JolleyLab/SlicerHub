import path from 'path';
import fs from 'fs';

/**
 * Safe container/DNS-friendly user id segment.
 */
export function safeSlicerGuiUserId(userId) {
    const raw = String(userId ?? '').trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
        throw new Error(`Invalid user id for Full Slicer session: ${raw}`);
    }
    return raw;
}

/** Max concurrent Full Slicer seats (containers) per user. */
export function getSlicerGuiMaxSeatsPerUser() {
    const n = Number(process.env.SLICER_GUI_MAX_SEATS_PER_USER || 2);
    if (!Number.isFinite(n) || n < 1) return 2;
    return Math.min(Math.floor(n), 8);
}

export function normalizeSlicerGuiSeatId(seatId, { max = getSlicerGuiMaxSeatsPerUser() } = {}) {
    const n = Number(seatId);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new Error(`Invalid Full Slicer seat id: ${seatId}`);
    }
    return n;
}

/** Lease / container session key: `{userId}-seat{n}` */
export function slicerGuiSessionKey(userId, seatId) {
    const safe = safeSlicerGuiUserId(userId);
    const seat = normalizeSlicerGuiSeatId(seatId);
    return `${safe}-seat${seat}`;
}

export function parseSlicerGuiSessionKey(sessionKey) {
    const raw = String(sessionKey || '').trim();
    const match = raw.match(/^(.*)-seat(\d+)$/);
    if (match) {
        return {
            userId: safeSlicerGuiUserId(match[1]),
            seatId: Number(match[2]),
            legacy: false
        };
    }
    // Legacy single-seat containers / leases keyed by user id only.
    return {
        userId: safeSlicerGuiUserId(raw),
        seatId: 1,
        legacy: true
    };
}

export function slicerGuiUserDir(userId, seatId = 1) {
    const safe = safeSlicerGuiUserId(userId);
    const seat = normalizeSlicerGuiSeatId(seatId);
    return path.join(process.cwd(), 'data', 'slicer-gui', 'users', safe, `seat${seat}`);
}

export function slicerGuiContainerName(userId, seatId = 1) {
    const safe = safeSlicerGuiUserId(userId);
    const seat = normalizeSlicerGuiSeatId(seatId);
    return `slicer-gui-${safe}-seat${seat}`;
}

/** Resolve container name from a lease sessionKey (supports legacy user-only keys). */
export function slicerGuiContainerNameFromSessionKey(sessionKey) {
    const parsed = parseSlicerGuiSessionKey(sessionKey);
    if (parsed.legacy) {
        return `slicer-gui-${parsed.userId}`;
    }
    return slicerGuiContainerName(parsed.userId, parsed.seatId);
}

/**
 * Map a host path to the form Docker Desktop on Windows accepts for binds
 * (e.g. C:/Users/... → /c/Users/...).
 */
export function toDockerBindPath(hostPath) {
    let normalized = String(hostPath || '').replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) {
        const drive = normalized[0].toLowerCase();
        normalized = `/${drive}${normalized.slice(2)}`;
    }
    return normalized;
}

/**
 * Map a path visible inside the backend container to a host path for `docker run -v`.
 * data/slicer-gui is mounted at /app/data/slicer-gui in compose.
 */
export function hostBindPathForSlicerGuiDir(nativeDir) {
    const hostRoot = (process.env.HOST_WORKSPACE_ROOT || '').trim().replace(/\\/g, '/');
    const native = path.resolve(nativeDir).replace(/\\/g, '/');
    const marker = '/data/slicer-gui/';
    const idx = native.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (hostRoot && idx >= 0) {
        const rel = native.slice(idx + 1); // data/slicer-gui/...
        return toDockerBindPath(`${hostRoot.replace(/\/$/, '')}/${rel}`);
    }
    return native;
}

export function ensureSlicerGuiUserDir(userId, seatId = 1) {
    const dir = slicerGuiUserDir(userId, seatId);
    fs.mkdirSync(dir, { recursive: true });
    try {
        fs.chmodSync(dir, 0o777);
    } catch {
        /* best effort */
    }
    return dir;
}

export function buildSlicerGuiViewerPath(userId, seatId = 1) {
    const safe = safeSlicerGuiUserId(userId);
    const seat = normalizeSlicerGuiSeatId(seatId);
    // vnc_lite builds ws://host/<path>. Behind nginx the socket must stay under the
    // per-seat prefix (not bare /websockify at the site root).
    const prefix = `slicer-gui/user-${safe}-seat${seat}`;
    const qs = new URLSearchParams({
        path: `${prefix}/websockify`,
        autoconnect: 'true',
        scale: 'true'
    });
    return `/${prefix}/vnc_lite.html?${qs.toString()}`;
}

export function requestFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.open-request.json');
}

export function busyFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.slicer-busy');
}

export function lastLoadedFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.last-loaded.json');
}

export function sceneLoadedFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.scene-loaded.json');
}

export function slicerReadyFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.slicer-ready');
}

export function clearSlicerReadyFile(userId, seatId = 1) {
    try {
        fs.unlinkSync(slicerReadyFilePath(userId, seatId));
    } catch {
        /* ignore */
    }
}

export function readSlicerReadyFile(userId, seatId = 1) {
    try {
        const raw = fs.readFileSync(slicerReadyFilePath(userId, seatId), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed?.ready === true;
    } catch {
        return false;
    }
}

export function loadResultFilePath(userId, seatId = 1) {
    return path.join(slicerGuiUserDir(userId, seatId), '.load-result.json');
}

export function readLoadResultFile(userId, seatId = 1) {
    try {
        const raw = fs.readFileSync(loadResultFilePath(userId, seatId), 'utf8');
        const parsed = JSON.parse(raw);
        const fileId = Number(parsed?.fileId);
        return {
            success: parsed?.success === true,
            fileId: Number.isInteger(fileId) && fileId > 0 ? fileId : null,
            path: parsed?.path || null,
            error: parsed?.error || null
        };
    } catch {
        return null;
    }
}

export function readLastLoadedFile(userId, seatId = 1) {
    let fromMarker = null;
    try {
        const raw = fs.readFileSync(lastLoadedFilePath(userId, seatId), 'utf8');
        const parsed = JSON.parse(raw);
        const fileId = Number(parsed?.fileId);
        if (Number.isInteger(fileId) && fileId > 0) {
            fromMarker = {
                fileId,
                fileName: parsed.fileName || null,
                useSimplifiedViewer: parsed.useSimplifiedViewer === true,
                // Older markers without sceneLoaded are treated as loaded (soft-close era).
                sceneLoaded: parsed.sceneLoaded !== false
            };
        }
    } catch {
        /* ignore */
    }

    // Slicer-owned marker (survives when .last-loaded.json is root-owned / unwritable).
    let fromScene = null;
    try {
        const raw = fs.readFileSync(sceneLoadedFilePath(userId, seatId), 'utf8');
        const parsed = JSON.parse(raw);
        const fileId = Number(parsed?.fileId);
        if (Number.isInteger(fileId) && fileId > 0 && parsed?.sceneLoaded === true) {
            fromScene = {
                fileId,
                fileName: parsed.fileName || null,
                useSimplifiedViewer: parsed.useSimplifiedViewer === true,
                sceneLoaded: true
            };
        }
    } catch {
        /* ignore */
    }

    const loadResult = readLoadResultFile(userId, seatId);

    if (fromMarker) {
        if (
            !fromMarker.sceneLoaded
            && fromScene
            && Number(fromScene.fileId) === fromMarker.fileId
        ) {
            fromMarker.sceneLoaded = true;
            if (!fromMarker.fileName && fromScene.fileName) {
                fromMarker.fileName = fromScene.fileName;
            }
        }
        // Backend stages with sceneLoaded=false; Slicer may fail to overwrite the
        // marker (permissions). A successful load-result for the same file is enough.
        if (
            !fromMarker.sceneLoaded
            && loadResult?.success
            && Number(loadResult.fileId) === fromMarker.fileId
        ) {
            fromMarker.sceneLoaded = true;
        }
        return fromMarker;
    }

    if (fromScene) {
        return fromScene;
    }

    // load-result alone is not enough for warm-skip: it can survive container
    // recreate and claim a scene that is no longer in memory. Prefer an
    // explicit scene-loaded / last-loaded marker written for this seat life.
    return null;
}

function chmodWritable(filePath) {
    try {
        fs.chmodSync(filePath, 0o666);
    } catch {
        /* best effort — Docker Desktop / Windows may ignore mode bits */
    }
}

export function writeLastLoadedFile(userId, {
    fileId,
    fileName = null,
    useSimplifiedViewer = false,
    sceneLoaded = true,
    seatId = 1
} = {}) {
    ensureSlicerGuiUserDir(userId, seatId);
    const payload = {
        fileId: Number(fileId),
        fileName,
        useSimplifiedViewer: useSimplifiedViewer === true,
        sceneLoaded: sceneLoaded === true,
        updatedAt: new Date().toISOString()
    };
    const dest = lastLoadedFilePath(userId, seatId);
    fs.writeFileSync(dest, JSON.stringify(payload));
    // Seat containers run as `slicer` and must be able to flip sceneLoaded=true.
    chmodWritable(dest);
    if (!sceneLoaded) {
        // Invalidate slicer-owned success marker until the new load finishes.
        try {
            fs.unlinkSync(sceneLoadedFilePath(userId, seatId));
        } catch {
            /* ignore */
        }
    }
}

export function clearLastLoadedFile(userId, seatId = 1) {
    try {
        fs.unlinkSync(lastLoadedFilePath(userId, seatId));
    } catch {
        /* ignore */
    }
    try {
        fs.unlinkSync(sceneLoadedFilePath(userId, seatId));
    } catch {
        /* ignore */
    }
    try {
        fs.unlinkSync(loadResultFilePath(userId, seatId));
    } catch {
        /* ignore */
    }
}
