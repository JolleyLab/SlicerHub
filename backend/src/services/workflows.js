/**
 * Workflows (docs/workflows-design.md): what the workflow routes and the case-workflow routes
 * share — collection names, the list queries, and the API shape of a workflow.
 */

import { getPayloadClient } from '../payload/index.js';
import { requireOwnerId, isOwner } from '../utils/ownedDocs.js';
import { ValidationError } from '../utils/errors.js';
import { sanitizeFileExtensions } from '../utils/validation.js';

export const WORKFLOWS = 'workflows';
export const CASE_WORKFLOWS = 'case-workflows';

/** The plain viewers, as workflows defined in code (the SPA's utils/builtinWorkflows.js launches them). */
export const BUILTIN_WORKFLOW_IDS = Object.freeze(['builtin:slicerweb', 'builtin:full', 'builtin:simplified']);

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
    source_updated_at: source.updatedAt,
});

/** Keys of a case's workflow defaults: the blank viewer, all other files, or a file type. */
export const DEFAULT_KEY_BLANK = 'blank';
export const DEFAULT_KEY_OTHER = '*';

/**
 * Validated `workflow_defaults` for a case: { blank?, '*'?, <file type>? } → one of `allowedIds`
 * (the case's approved rows and the built-ins). Empty values are dropped: "each person's default".
 */
export function sanitizeWorkflowDefaults(value, allowedIds) {
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Defaults must be an object');
    const allowed = new Set(allowedIds.map(String));
    const out = {};
    for (const [rawKey, rawId] of Object.entries(value)) {
        const id = String(rawId ?? '').trim();
        if (!id) continue;
        const key = rawKey === DEFAULT_KEY_BLANK || rawKey === DEFAULT_KEY_OTHER
            ? rawKey
            : sanitizeFileExtensions([rawKey], { label: 'Default file type' })[0];
        if (!allowed.has(id)) throw new ValidationError(`Default for ${key} is not a workflow of this case`);
        out[key] = id;
    }
    if (Object.keys(out).length > 32) throw new ValidationError('Too many defaults');
    return out;
}

/** `defaults` without the entries that point at `removedId`. */
export const withoutDefault = (defaults, removedId) => Object.fromEntries(
    Object.entries(defaults || {}).filter(([, id]) => String(id) !== String(removedId)),
);

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
    isMine: isOwner(doc, req),
    // The key changes with each upload, so it versions the URL: a new icon is never hidden by a
    // cached old one, and editing anything else doesn't make browsers fetch the icon again.
    iconUrl: doc.icon_key ? `/api/workflows/${doc.id}/icon?v=${encodeURIComponent(doc.icon_key.split('/').pop())}` : null,
    updatedAt: doc.updatedAt,
});
