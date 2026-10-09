/**
 * CRUD for case_attachment_versions in Directus.
 *
 * Version records are stored as a Directus collection so the metadata lives in the same database
 * as everything else (SQLite locally, PostgreSQL in cloud via Directus) and is visible in the
 * Directus admin panel. The Directus collection must exist before these functions are called —
 * call ensureVersionsCollection() at startup.
 */

import config from '../config/index.js';
import { directusFetch } from './directus.js';

export const VERSIONS_COLLECTION = 'case_attachment_versions';

// ---------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------

/**
 * Create the case_attachment_versions collection in Directus if it doesn't already exist.
 * Safe to call on every startup — no-ops when the collection is present.
 */
export async function ensureVersionsCollection() {
    if (!config.directus.casesEnabled || !config.directus.token) return;

    // Check existence first to avoid a needless POST
    try {
        await directusFetch(`/collections/${VERSIONS_COLLECTION}`);
        return; // already exists
    } catch (_) {
        // 403 or 404 — collection doesn't exist, fall through to create
    }

    await directusFetch('/collections', {
        method: 'POST',
        body: {
            collection: VERSIONS_COLLECTION,
            meta: {
                accountability: 'all',
                icon: 'history',
                note: 'Version history for case attachment scene files'
            },
            schema: {},
            fields: [
                {
                    field: 'id',
                    type: 'uuid',
                    meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
                    schema: { is_primary_key: true, has_auto_increment: false }
                },
                {
                    field: 'attachment_id',
                    type: 'string',
                    meta: { required: true },
                    schema: { is_nullable: false }
                },
                {
                    field: 'case_id',
                    type: 'string',
                    meta: { required: true },
                    schema: { is_nullable: false }
                },
                {
                    field: 'file_id',
                    type: 'string',
                    meta: { required: true, note: 'Directus file UUID' },
                    schema: { is_nullable: false }
                },
                {
                    field: 'date_created',
                    type: 'dateTime',
                    meta: { special: ['date-created'], readonly: true },
                    schema: { is_nullable: true }
                },
                {
                    field: 'created_by_user_id',
                    type: 'integer',
                    meta: { note: 'App user id (users table)' },
                    schema: { is_nullable: true }
                },
                {
                    field: 'label',
                    type: 'string',
                    meta: { interface: 'input', note: 'Optional human label, e.g. "pre-op"' },
                    schema: { is_nullable: true }
                },
                {
                    field: 'is_pinned',
                    type: 'boolean',
                    meta: { interface: 'toggle', note: 'Pinned versions are exempt from automated cleanup' },
                    schema: { is_nullable: false, default_value: false }
                },
                {
                    field: 'archive_status',
                    type: 'string',
                    meta: { note: 'active | archived | restoring' },
                    schema: { is_nullable: false, default_value: 'active' }
                },
                {
                    field: 'storage_tier',
                    type: 'string',
                    meta: { note: 'null = hot; standard_ia; glacier_ir (populated by prune job)' },
                    schema: { is_nullable: true }
                }
            ]
        }
    });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createVersion({ attachmentId, caseId, fileId, userId, label = null }, { accessToken }) {
    const body = {
        attachment_id: attachmentId,
        case_id: caseId,
        file_id: fileId,
        created_by_user_id: userId ?? null,
        label,
        is_pinned: false,
        archive_status: 'active',
        storage_tier: null
    };
    return directusFetch(`/items/${VERSIONS_COLLECTION}`, { method: 'POST', accessToken, body });
}

/**
 * List versions for one attachment, newest first, with optional pagination.
 * Returns the Directus data array.
 */
export async function listVersions(attachmentId, { accessToken, limit = 50, offset = 0 }) {
    const result = await directusFetch(`/items/${VERSIONS_COLLECTION}`, {
        accessToken,
        query: {
            'filter[attachment_id][_eq]': attachmentId,
            sort: '-date_created',
            limit,
            offset,
            fields: 'id,date_created,created_by_user_id,label,is_pinned,archive_status,storage_tier,file_id'
        }
    });
    return Array.isArray(result?.data) ? result.data : [];
}

/**
 * Fetch versions eligible for pruning (not pinned, sorted oldest-first).
 * Uses the service token — does not require a per-user token.
 */
export async function listPrunableVersions(attachmentId) {
    const result = await directusFetch(`/items/${VERSIONS_COLLECTION}`, {
        query: {
            'filter[attachment_id][_eq]': attachmentId,
            'filter[is_pinned][_eq]': false,
            sort: 'date_created',
            limit: -1,
            fields: 'id,date_created,file_id,archive_status,storage_tier'
        }
    });
    return Array.isArray(result?.data) ? result.data : [];
}

/** Versions across ALL attachments, for the global prune job. Oldest first. */
export async function listAllPrunableVersions() {
    const result = await directusFetch(`/items/${VERSIONS_COLLECTION}`, {
        query: {
            'filter[is_pinned][_eq]': false,
            sort: 'date_created',
            limit: -1,
            fields: 'id,date_created,attachment_id,file_id,archive_status,storage_tier'
        }
    });
    return Array.isArray(result?.data) ? result.data : [];
}

export async function updateVersion(versionId, patch, { accessToken }) {
    return directusFetch(`/items/${VERSIONS_COLLECTION}/${encodeURIComponent(versionId)}`, {
        method: 'PATCH',
        accessToken,
        body: patch
    });
}

export async function deleteVersion(versionId) {
    return directusFetch(`/items/${VERSIONS_COLLECTION}/${encodeURIComponent(versionId)}`, {
        method: 'DELETE'
    });
}
