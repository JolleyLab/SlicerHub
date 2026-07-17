import File from '../models/File.js';
import ProjectGpu from '../models/ProjectGpu.js';
import { syncProjectFile } from './orchestrator.js';

/** projectId → in-flight promise (latest link in the chain) */
const activePrestageJobs = new Map();

function prestageLimits() {
    const maxFiles = Math.max(0, parseInt(process.env.GPU_PRESTAGE_MAX_FILES || '3', 10));
    const maxMb = Math.max(1, parseInt(process.env.GPU_PRESTAGE_MAX_MB || '500', 10));
    const maxFileMb = Math.max(1, parseInt(process.env.GPU_PRESTAGE_MAX_FILE_MB || '1024', 10));
    return {
        maxFiles,
        maxTotalBytes: maxMb * 1024 * 1024,
        maxFileBytes: maxFileMb * 1024 * 1024
    };
}

function sortByLikelihood(files) {
    return [...files].sort((a, b) => {
        const aView = a.last_viewed_at ? new Date(a.last_viewed_at).getTime() : 0;
        const bView = b.last_viewed_at ? new Date(b.last_viewed_at).getTime() : 0;
        if (bView !== aView) return bView - aView;
        const aMod = new Date(a.last_modified_at || a.upload_date).getTime();
        const bMod = new Date(b.last_modified_at || b.upload_date).getTime();
        return bMod - aMod;
    });
}

export function selectFilesToPrestage(projectFiles, { fileIds = null } = {}) {
    const limits = prestageLimits();
    if (!projectFiles.length) return [];

    if (Array.isArray(fileIds) && fileIds.length > 0) {
        const idSet = new Set(fileIds.map((id) => Number(id)).filter((id) => id > 0));
        return projectFiles.filter((file) => idSet.has(file.id));
    }

    if (limits.maxFiles === 0) return [];

    const selected = [];
    let totalBytes = 0;
    for (const file of sortByLikelihood(projectFiles)) {
        if (selected.length >= limits.maxFiles) break;
        const size = Number(file.file_size) || 0;
        if (size > limits.maxFileBytes) {
            continue;
        }
        // Always take the top candidate (typical MRB open) even if it exceeds the total budget.
        if (selected.length === 0) {
            selected.push(file);
            totalBytes += size;
            continue;
        }
        if (size > 0 && totalBytes + size > limits.maxTotalBytes) {
            break;
        }
        selected.push(file);
        totalBytes += size;
    }
    return selected;
}

export function isPrestageActive(projectId) {
    return activePrestageJobs.has(projectId);
}

/**
 * If a background prestage is running, wait for it before opening a file (avoids duplicate upload).
 */
export async function waitForPrestageIdle(projectId, { timeoutMs = 180000 } = {}) {
    const job = activePrestageJobs.get(projectId);
    if (!job) return;

    let timer;
    try {
        await Promise.race([
            job.catch(() => {}),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Prestage still running')), timeoutMs);
            })
        ]);
    } catch (err) {
        console.warn(`waitForPrestageIdle project ${projectId}: ${err.message}`);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function prestageProjectFiles({ projectId, userId, fileIds = null }) {
    const instance = ProjectGpu.getInstance(projectId);
    if (!ProjectGpu.isRemoteRunning(instance)) {
        return { status: 'skipped', reason: 'gpu_not_running', results: [] };
    }

    const projectFiles = File.findByProjectId(projectId);
    const targets = selectFilesToPrestage(projectFiles, { fileIds });
    if (!targets.length) {
        return { status: 'skipped', reason: 'no_candidates', results: [] };
    }

    const results = [];
    for (const file of targets) {
        const started = Date.now();
        try {
            const syncResult = await syncProjectFile({ projectId, file, launcherUserId: userId });
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            console.log(
                `GPU prestage project ${projectId} file ${file.id} `
                + `(${file.original_name}): ${syncResult?.status || 'synced'} in ${elapsed}s`
            );
            results.push({
                fileId: file.id,
                name: file.original_name,
                status: syncResult?.status === 'skipped' ? 'skipped' : 'synced'
            });
        } catch (err) {
            console.warn(`Prestage failed for project ${projectId} file ${file.id}:`, err.message);
            results.push({
                fileId: file.id,
                name: file.original_name,
                status: 'error',
                error: err.message
            });
        }
    }

    return {
        status: 'ok',
        results,
        synced: results.filter((r) => r.status === 'synced').length,
        skipped: results.filter((r) => r.status === 'skipped').length
    };
}

/**
 * Serialize all prestages for a project (API, hover, auto, billing) so open can wait
 * on one job and concurrent requests cannot race-upload the same scene.
 * Later requests chain after the current job rather than being dropped.
 */
export function enqueuePrestage({ projectId, userId, fileIds = null }) {
    const prev = activePrestageJobs.get(projectId) || Promise.resolve();
    const ids = Array.isArray(fileIds) && fileIds.length ? fileIds : null;

    const job = prev
        .catch(() => {})
        .then(() => prestageProjectFiles({ projectId, userId, fileIds: ids }))
        .then((result) => {
            console.log(`GPU prestage finished for project ${projectId}:`, {
                synced: result.synced,
                skipped: result.skipped,
                targets: result.results?.length ?? 0
            });
            return result;
        })
        .catch((err) => {
            console.warn(`GPU prestage failed for project ${projectId}:`, err.message);
            throw err;
        })
        .finally(() => {
            if (activePrestageJobs.get(projectId) === job) {
                activePrestageJobs.delete(projectId);
            }
        });

    activePrestageJobs.set(projectId, job);
    return job;
}

/** @deprecated Prefer enqueuePrestage — kept as alias for billing auto-prestage. */
export function prestageProjectFilesBackground(opts) {
    return enqueuePrestage(opts);
}
