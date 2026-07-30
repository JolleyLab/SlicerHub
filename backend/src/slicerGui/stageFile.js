import fs from 'fs';
import path from 'path';
import storage from '../storage/index.js';
import { ValidationError } from '../utils/errors.js';
import {
    ensureSlicerGuiUserDir,
    requestFilePath,
    busyFilePath,
    readLastLoadedFile
} from './paths.js';

function unlinkQuiet(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        /* best effort */
    }
}

function chmodQuiet(filePath, mode) {
    try {
        fs.chmodSync(filePath, mode);
    } catch {
        /* best effort */
    }
}

/** Clear open/busy markers so a prior launch cannot race a new session. */
export function clearSlicerGuiPendingOpen(userId, seatId = 1) {
    const destDir = ensureSlicerGuiUserDir(userId, seatId);
    unlinkQuiet(requestFilePath(userId, seatId));
    unlinkQuiet(busyFilePath(userId, seatId));
    unlinkQuiet(path.join(destDir, '.open-request.json.tmp'));
    return destDir;
}

/**
 * Stage a project file into a per-seat Full Slicer data directory and
 * write open-request + busy markers for slicer_session.py.
 */
export async function stageProjectFileForSlicerGui({
    file,
    launcherUserId,
    useSimplifiedViewer = false,
    seatId = 1
}) {
    if (!(await storage.exists(file.file_path))) {
        throw new ValidationError('File not found on server');
    }

    const safeName = path.basename(file.original_name || file.file_path);
    const stagedName = `${file.id}-${safeName}`;
    const destDir = ensureSlicerGuiUserDir(launcherUserId, seatId);
    const destPath = path.join(destDir, stagedName);

    let sourceKey = file.file_path;
    if (file.user_id !== Number(launcherUserId) && String(file.user_id) !== String(launcherUserId)) {
        const sharedName = `shared-${file.id}-${safeName}`;
        sourceKey = await storage.ensureStagedCopy({
            sourceKey: file.file_path,
            userId: launcherUserId,
            fileName: sharedName
        });
    }

    const srcPath = storage.resolvePath(sourceKey);
    let copied = false;
    try {
        const srcStat = fs.statSync(srcPath);
        if (!(fs.existsSync(destPath) && fs.statSync(destPath).size === srcStat.size)) {
            fs.copyFileSync(srcPath, destPath);
            copied = true;
        }
    } catch {
        fs.copyFileSync(srcPath, destPath);
        copied = true;
    }
    if (copied) {
        chmodQuiet(destPath, 0o666);
    }

    const containerPath = `/home/slicer/data/${stagedName}`;
    const requestFile = requestFilePath(launcherUserId, seatId);
    const busyFile = busyFilePath(launcherUserId, seatId);
    const requestPayload = {
        fileId: file.id,
        fileName: safeName,
        stagedName,
        containerPath,
        useSimplifiedViewer: useSimplifiedViewer === true,
        requestedAt: new Date().toISOString()
    };

    fs.writeFileSync(busyFile, JSON.stringify({
        busy: true,
        message: 'staging',
        fileId: file.id,
        updatedAt: new Date().toISOString()
    }, null, 2));
    chmodQuiet(busyFile, 0o666);

    fs.writeFileSync(`${requestFile}.tmp`, JSON.stringify(requestPayload, null, 2));
    fs.renameSync(`${requestFile}.tmp`, requestFile);
    chmodQuiet(requestFile, 0o666);

    return {
        fileName: safeName,
        stagedName,
        containerPath,
        useSimplifiedViewer: requestPayload.useSimplifiedViewer,
        dataDir: destDir,
        seatId
    };
}

/**
 * Re-apply Full vs Simplified chrome on a warm seat without reloading the MRB.
 * Used on soft-close reopen when the scene is already in memory.
 */
export function requestSlicerGuiModeApply({
    launcherUserId,
    fileId = null,
    fileName = null,
    useSimplifiedViewer = false,
    seatId = 1
} = {}) {
    const destDir = ensureSlicerGuiUserDir(launcherUserId, seatId);
    const persisted = readLastLoadedFile(launcherUserId, seatId);

    // Prefer the already-staged scene path so the poller can validate the file exists.
    let stagedName = null;
    let containerPath = '/home/slicer/data';
    try {
        const entries = fs.readdirSync(destDir);
        const match = entries.find((name) => {
            if (fileId != null && String(name).startsWith(`${fileId}-`)) return true;
            if (fileName && String(name).endsWith(fileName)) return true;
            return false;
        });
        if (match) {
            stagedName = match;
            containerPath = `/home/slicer/data/${match}`;
        }
    } catch {
        /* ignore */
    }

    const requestFile = requestFilePath(launcherUserId, seatId);
    const busyFile = busyFilePath(launcherUserId, seatId);
    const requestPayload = {
        fileId: fileId ?? persisted?.fileId ?? null,
        fileName: fileName || persisted?.fileName || stagedName,
        stagedName,
        containerPath,
        useSimplifiedViewer: useSimplifiedViewer === true,
        skipLoad: true,
        requestedAt: new Date().toISOString()
    };

    fs.writeFileSync(busyFile, JSON.stringify({
        busy: true,
        message: 'applying-mode',
        fileId: requestPayload.fileId,
        updatedAt: new Date().toISOString()
    }, null, 2));
    chmodQuiet(busyFile, 0o666);

    fs.writeFileSync(`${requestFile}.tmp`, JSON.stringify(requestPayload, null, 2));
    fs.renameSync(`${requestFile}.tmp`, requestFile);
    chmodQuiet(requestFile, 0o666);

    return {
        fileName: requestPayload.fileName,
        containerPath,
        useSimplifiedViewer: requestPayload.useSimplifiedViewer,
        skipped: true,
        modeOnly: true,
        seatId
    };
}

/**
 * Stage an already-cached host file (e.g. Directus asset) into the per-seat
 * Full Slicer data directory and write open-request + busy markers.
 */
export async function stageCachedFileForSlicerGui({
    sourcePath,
    stagedKey,
    fileName,
    launcherUserId,
    useSimplifiedViewer = false,
    seatId = 1
}) {
    const src = String(sourcePath || '').trim();
    if (!src || !fs.existsSync(src)) {
        throw new ValidationError('Cached file not found on server');
    }

    const key = String(stagedKey || '').trim();
    if (!key) {
        throw new ValidationError('stagedKey is required');
    }

    const safeName = path.basename(fileName || src);
    const stagedName = `${key}-${safeName}`;
    const destDir = ensureSlicerGuiUserDir(launcherUserId, seatId);
    const destPath = path.join(destDir, stagedName);

    let copied = false;
    try {
        const srcStat = fs.statSync(src);
        if (!(fs.existsSync(destPath) && fs.statSync(destPath).size === srcStat.size)) {
            fs.copyFileSync(src, destPath);
            copied = true;
        }
    } catch {
        fs.copyFileSync(src, destPath);
        copied = true;
    }
    if (copied) {
        chmodQuiet(destPath, 0o666);
    }

    const containerPath = `/home/slicer/data/${stagedName}`;
    const requestFile = requestFilePath(launcherUserId, seatId);
    const busyFile = busyFilePath(launcherUserId, seatId);
    const requestPayload = {
        fileId: key,
        fileName: safeName,
        stagedName,
        containerPath,
        useSimplifiedViewer: useSimplifiedViewer === true,
        requestedAt: new Date().toISOString()
    };

    fs.writeFileSync(busyFile, JSON.stringify({
        busy: true,
        message: 'staging',
        fileId: key,
        updatedAt: new Date().toISOString()
    }, null, 2));
    chmodQuiet(busyFile, 0o666);

    fs.writeFileSync(`${requestFile}.tmp`, JSON.stringify(requestPayload, null, 2));
    fs.renameSync(`${requestFile}.tmp`, requestFile);
    chmodQuiet(requestFile, 0o666);

    return {
        fileName: safeName,
        stagedName,
        containerPath,
        useSimplifiedViewer: requestPayload.useSimplifiedViewer,
        dataDir: destDir,
        stagedKey: key,
        seatId
    };
}

export function readSlicerGuiBusyStatus(userId, seatId = 1) {
    ensureSlicerGuiUserDir(userId, seatId);
    const busyFile = busyFilePath(userId, seatId);
    const requestFile = requestFilePath(userId, seatId);
    let busy = false;
    let message = '';
    let updatedAt = null;

    if (fs.existsSync(busyFile)) {
        busy = true;
        try {
            const payload = JSON.parse(fs.readFileSync(busyFile, 'utf8'));
            message = payload.message || 'loading';
            updatedAt = payload.updatedAt || null;
        } catch {
            message = 'loading';
        }
    } else if (fs.existsSync(requestFile)) {
        busy = true;
        message = 'queued';
    }

    return { busy, message, updatedAt, seatId };
}
