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

export function slicerGuiUserDir(userId) {
    const safe = safeSlicerGuiUserId(userId);
    return path.join(process.cwd(), 'data', 'slicer-gui', 'users', safe);
}

export function slicerGuiContainerName(userId) {
    return `slicer-gui-${safeSlicerGuiUserId(userId)}`;
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

export function ensureSlicerGuiUserDir(userId) {
    const dir = slicerGuiUserDir(userId);
    fs.mkdirSync(dir, { recursive: true });
    try {
        fs.chmodSync(dir, 0o777);
    } catch {
        /* best effort */
    }
    return dir;
}

export function buildSlicerGuiViewerPath(userId) {
    const safe = safeSlicerGuiUserId(userId);
    return `/slicer-gui/user-${safe}/vnc_lite.html?autoconnect=true&resize=remote`;
}

export function requestFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.open-request.json');
}

export function busyFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.slicer-busy');
}

export function lastLoadedFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.last-loaded.json');
}

export function slicerReadyFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.slicer-ready');
}

export function clearSlicerReadyFile(userId) {
    try {
        fs.unlinkSync(slicerReadyFilePath(userId));
    } catch {
        /* ignore */
    }
}

export function readSlicerReadyFile(userId) {
    try {
        const raw = fs.readFileSync(slicerReadyFilePath(userId), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed?.ready === true;
    } catch {
        return false;
    }
}

export function readLastLoadedFile(userId) {
    try {
        const raw = fs.readFileSync(lastLoadedFilePath(userId), 'utf8');
        const parsed = JSON.parse(raw);
        const fileId = Number(parsed?.fileId);
        if (!Number.isInteger(fileId) || fileId <= 0) return null;
        return {
            fileId,
            fileName: parsed.fileName || null,
            useSimplifiedViewer: parsed.useSimplifiedViewer === true,
            // Older markers without sceneLoaded are treated as loaded (soft-close era).
            sceneLoaded: parsed.sceneLoaded !== false
        };
    } catch {
        return null;
    }
}

export function writeLastLoadedFile(userId, {
    fileId,
    fileName = null,
    useSimplifiedViewer = false,
    sceneLoaded = true
} = {}) {
    ensureSlicerGuiUserDir(userId);
    const payload = {
        fileId: Number(fileId),
        fileName,
        useSimplifiedViewer: useSimplifiedViewer === true,
        sceneLoaded: sceneLoaded === true,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(lastLoadedFilePath(userId), JSON.stringify(payload));
}

export function clearLastLoadedFile(userId) {
    try {
        fs.unlinkSync(lastLoadedFilePath(userId));
    } catch {
        /* ignore */
    }
}

