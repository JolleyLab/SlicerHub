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
        let hostPath = `${hostRoot.replace(/\/$/, '')}/${rel}`;
        // Docker Desktop on Windows often wants /c/Users/... form for binds from Linux VMs
        if (/^[A-Za-z]:\//.test(hostPath)) {
            const drive = hostPath[0].toLowerCase();
            hostPath = `/${drive}${hostPath.slice(2)}`;
        }
        return hostPath;
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
    return `/slicer-gui/user-${safe}/vnc.html?autoconnect=true&resize=scale`;
}

export function requestFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.open-request.json');
}

export function busyFilePath(userId) {
    return path.join(slicerGuiUserDir(userId), '.slicer-busy');
}
