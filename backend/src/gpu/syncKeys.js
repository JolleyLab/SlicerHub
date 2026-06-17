import path from 'path';

export function resolveSyncTarget(file, launcherUserId) {
    let userId = String(file.user_id);
    let fileName = path.basename(file.file_path);

    if (file.user_id !== launcherUserId) {
        fileName = `shared-${file.id}-${path.basename(file.file_path)}`;
        userId = String(launcherUserId);
    }

    return {
        cacheKey: `${userId}/${fileName}`,
        userId,
        fileName
    };
}

export function isFileStaged(file, syncedFiles, launcherUserId) {
    if (!syncedFiles || !file) return false;
    const { cacheKey } = resolveSyncTarget(file, launcherUserId);
    const entry = syncedFiles[cacheKey];
    if (!entry) return false;
    const expectedBytes = Number(file.file_size) || 0;
    return !expectedBytes || entry.bytes === expectedBytes;
}
