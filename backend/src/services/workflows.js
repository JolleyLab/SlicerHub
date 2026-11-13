/**
 * Workflows (docs/workflows-design.md): what the workflow routes and the case-workflow routes
 * share — collection names, the list queries, and the API shape of a workflow.
 */

import { getPayloadClient } from '../payload/index.js';
import { requireOwnerId, isOwner } from '../utils/ownedDocs.js';
import { ValidationError } from '../utils/errors.js';

export const WORKFLOWS = 'workflows';
export const CASE_WORKFLOWS = 'case-workflows';

/**
 * A workflow's startup configuration: what's passed to the viewer once it has started. Only
 * these keys are accepted, so a public workflow can't make a viewer do anything we haven't
 * chosen to support (docs/workflows-design.md › Startup configuration).
 */
export const STARTUP_CONFIG_KEYS = Object.freeze({
    module: /^[A-Za-z][A-Za-z0-9_]{0,99}$/, // a Slicer module name, e.g. SimplifiedViewer
});

/** Validated startup configuration; empty values are dropped, unknown keys refused. */
export function sanitizeStartupConfig(value) {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw ValidationError.fromKey('workflow.startup_config_object');
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        const pattern = STARTUP_CONFIG_KEYS[key];
        if (!pattern) throw ValidationError.fromKey('workflow.startup_config_key', { key: String(key).slice(0, 40) });
        const text = String(raw ?? '').trim();
        if (!text) continue;
        if (!pattern.test(text)) throw ValidationError.fromKey('workflow.startup_config_value', { key });
        out[key] = text;
    }
    return out;
}

/** Rows from before requests existed have no status; they were approvals. */
export const isApproved = (row) => !row.status || row.status === 'approved';

/** An approved case workflow as the API returns it; `source` (if still visible) shows whether it changed. */
export const toApproval = (row, source = null) => ({
    id: row.id,
    workflowId: row.workflow,
    name: row.name,
    description: row.description || '',
    extensions: row.extensions || [],
    fileTypes: row.file_types || [],
    startupConfig: row.startup_config || {},
    approvedAt: row.decided_at ?? null,
    updateAvailable: Boolean(source) && Date.parse(source.updatedAt) > Date.parse(row.source_updated_at),
});

/** What a case keeps of a workflow: copied on request and again on approval. */
export const workflowCopy = (source) => ({
    workflow: String(source.id),
    name: source.name,
    description: source.description || '',
    extensions: source.extensions || [],
    file_types: source.file_types || [],
    startup_config: source.startup_config || {},
    source_updated_at: source.updatedAt,
});

/** At most 200 rows: plenty for now; the public gallery will need paging. */
export async function findAll(collection, where, sort) {
    const { docs } = await getPayloadClient().find({ collection, where, sort, depth: 0, limit: 200 });
    return docs;
}

export const myWorkflows = (req) => findAll(WORKFLOWS, { owner_id: { equals: requireOwnerId(req) } }, 'name');
export const publicWorkflows = () => findAll(WORKFLOWS, { visibility: { equals: 'public' } }, 'name');

/** A workflow as the API returns it (never its owner_id). */
export const toWorkflow = (doc, req) => ({
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    visibility: doc.visibility,
    extensions: doc.extensions || [],
    fileTypes: doc.file_types || [],
    startupConfig: doc.startup_config || {},
    isMine: isOwner(doc, req),
    // The key changes with each upload, so it versions the URL: a new icon is never hidden by a
    // cached old one, and editing anything else doesn't make browsers fetch the icon again.
    iconUrl: doc.icon_key ? `/api/workflows/${doc.id}/icon?v=${encodeURIComponent(doc.icon_key.split('/').pop())}` : null,
    updatedAt: doc.updatedAt,
});
