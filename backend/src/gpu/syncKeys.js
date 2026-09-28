import path from 'path';

/**
 * Per-user working copy on the GPU (session opens this path).
 * Collaborators get a shared-* name under their own user id so saves stay isolated.
 */
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

/**
 * Immutable project-scoped cache object on the GPU.
 * Uploaded once per billing instance; cloned into each user's working copy.
 * Reserved user id so it never collides with real accounts.
 */
export function resolveProjectCacheTarget(file, projectId) {
    const id = Number(projectId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('projectId is required for GPU cache sync');
    }
    const fileName = `f${file.id}-${path.basename(file.file_path)}`;
    const userId = `_cache_p${id}`;
    return {
        cacheKey: `${userId}/${fileName}`,
        userId,
        fileName
    };
}

/** Flat staging name used by Vast Full Slicer bridge (/home/slicer/data). */
export function resolveFullSlicerStagedName(file) {
    return `${file.id}-${path.basename(file.original_name || file.file_path)}`;
}

export function isFileStaged(file, syncedFiles, launcherUserId, { vastFullSlicer = false } = {}) {
    if (!syncedFiles || !file) return false;
    const cacheKey = vastFullSlicer
        ? resolveFullSlicerStagedName(file)
        : resolveSyncTarget(file, launcherUserId).cacheKey;
    const entry = syncedFiles[cacheKey];
    if (!entry) return false;
    const expectedBytes = Number(file.file_size) || 0;
    return !expectedBytes || entry.bytes === expectedBytes;
}

