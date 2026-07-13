import fs from 'fs';
import path from 'path';
import storage from '../storage/index.js';
import { ValidationError } from '../utils/errors.js';
import { ensureSlicerGuiUserDir } from './paths.js';

/**
 * Stage a project file into a per-user Full Slicer data directory and
 * write open-request + busy markers for slicer_session.py.
 */
export async function stageProjectFileForSlicerGui({
    file,
    launcherUserId,
    useSimplifiedViewer = false
}) {
    if (!(await storage.exists(file.file_path))) {
        throw new ValidationError('File not found on server');
    }

    const safeName = path.basename(file.original_name || file.file_path);
    const stagedName = `${file.id}-${safeName}`;
    const destDir = ensureSlicerGuiUserDir(launcherUserId);
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
    fs.copyFileSync(srcPath, destPath);
    try {
        fs.chmodSync(destPath, 0o666);
    } catch {
        /* best effort */
    }
    try {
        const fd = fs.openSync(destPath, 'r');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
    } catch {
        /* fsync optional */
    }

    const containerPath = `/home/slicer/data/${stagedName}`;
    const requestFile = path.join(destDir, '.open-request.json');
    const busyFile = path.join(destDir, '.slicer-busy');
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
    try {
        fs.chmodSync(busyFile, 0o666);
    } catch {
        /* best effort */
    }

    fs.writeFileSync(`${requestFile}.tmp`, JSON.stringify(requestPayload, null, 2));
    fs.renameSync(`${requestFile}.tmp`, requestFile);
    try {
        fs.chmodSync(requestFile, 0o666);
    } catch {
        /* best effort */
    }

    console.log('Staged full-slicer file', {
        userId: launcherUserId,
        destPath,
        containerPath,
        requestedAt: requestPayload.requestedAt,
        useSimplifiedViewer: requestPayload.useSimplifiedViewer,
        bytes: fs.statSync(destPath).size
    });

    return {
        fileName: safeName,
        stagedName,
        containerPath,
        useSimplifiedViewer: requestPayload.useSimplifiedViewer,
        dataDir: destDir
    };
}

export function readSlicerGuiBusyStatus(userId) {
    const destDir = ensureSlicerGuiUserDir(userId);
    const busyFile = path.join(destDir, '.slicer-busy');
    const requestFile = path.join(destDir, '.open-request.json');
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

    return { busy, message, updatedAt };
}
