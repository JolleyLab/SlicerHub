/**
 * Pluggable strategy for what happens to a Directus file when a version is pruned.
 *
 * PRUNE_STRATEGY=delete  (default) — delete the file from Directus/storage entirely.
 * PRUNE_STRATEGY=archive           — transition the file to cheaper storage and mark it archived.
 *                                    Stub today; fill in the S3/Azure SDK call when cloud storage
 *                                    is configured without changing the call sites.
 */

import config from '../config/index.js';
import { directusFetch } from './directus.js';
import { updateVersion, deleteVersion } from './attachmentVersions.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the configured prune strategy to a single version.
 * @param {{ id: string, file_id: string }} version
 */
export async function pruneFile(version) {
    return config.versioning.pruneStrategy === 'archive'
        ? archiveFile(version)
        : deleteFile(version);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

async function deleteFile(version) {
    try {
        await directusFetch(`/files/${encodeURIComponent(version.file_id)}`, { method: 'DELETE' });
    } catch (err) {
        if (!isNotFound(err)) throw err; // already gone is fine
    }
    await deleteVersion(version.id).catch(() => {});
}

async function archiveFile(version) {
    const tier = config.versioning.archiveTier;

    // ------------------------------------------------------------------
    // Tier-transition stub — fill in when cloud storage is configured.
    //
    // AWS S3 (PRUNE_STRATEGY=archive, STORAGE_DRIVER=s3):
    //   import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
    //   await s3.send(new CopyObjectCommand({
    //       Bucket: process.env.STORAGE_S3_BUCKET,
    //       CopySource: `${bucket}/${key}`,
    //       Key: key,
    //       StorageClass: tier === 'glacier_ir' ? 'GLACIER_IR' : 'STANDARD_IA',
    //       MetadataDirective: 'COPY'
    //   }));
    //
    // Azure Blob (PRUNE_STRATEGY=archive, STORAGE_DRIVER=azure):
    //   await blockBlobClient.setAccessTier(tier === 'glacier_ir' ? 'Archive' : 'Cool');
    // ------------------------------------------------------------------

    if (!config.versioning.storageDriverConfigured) {
        console.log(
            `[fileStorage] archive: no storage driver configured — skipping tier transition ` +
            `for file ${version.file_id} (would use tier=${tier})`
        );
    }

    await updateVersion(version.id, { archive_status: 'archived', storage_tier: tier }, {})
        .catch((err) => console.warn(`[fileStorage] failed to mark version ${version.id} as archived:`, err.message));
}

function isNotFound(err) {
    return err?.message?.includes('404') || err?.message?.includes('not found');
}
