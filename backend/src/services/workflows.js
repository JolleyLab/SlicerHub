/**
 * Workflows (docs/workflows-design.md): what the workflow routes and the case-workflow routes
 * share — collection names, the list queries, and the API shape of a workflow.
 */

import { getPayloadClient } from '../payload/index.js';
import { requireOwnerId, isOwner } from '../utils/ownedDocs.js';
import { ValidationError } from '../utils/errors.js';

export const WORKFLOWS = 'workflows';
export const CASE_WORKFLOWS = 'case-workflows';

export const VISIBILITY = Object.freeze({ PRIVATE: 'private', PUBLIC: 'public' });
/** The viewer a workflow opens in. */
export const VIEWER = Object.freeze({ SLICERWEB: 'slicerweb', FULL: 'full' });
/** Rows from before workflows named a viewer open in SlicerWeb. */
export const viewerOf = (doc) => doc?.viewer || VIEWER.SLICERWEB;

const OPEN_WITH_KEY = new RegExp(`^(case:\\d{1,12}|viewer:(${Object.values(VIEWER).join('|')}))$`);
/**
 * A file's default (attachments.open_with): one of the case's workflows or a plain viewer, as the
 * Open menu keys them. Only the form is checked: one that no longer applies is skipped when opening.
 */
export const isOpenWithKey = (value) => typeof value === 'string' && OPEN_WITH_KEY.test(value);
/** A case-workflows row: requested, approved (members can use it), or declined. */
export const REQUEST_STATUS = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', DECLINED: 'declined' });

/**
 * A workflow's startup configuration: what's passed to the viewer once it has started. Only
 * these keys are accepted, so a public workflow can't make a viewer do anything we haven't
 * chosen to support (docs/workflows-design.md › Startup configuration).
 */
export const STARTUP_CONFIG_KEYS = Object.freeze({
    module: /^[A-Za-z][A-Za-z0-9_]{0,99}$/, // a Slicer module name, e.g. SimplifiedViewer
});

/** SlicerHeart's simplified viewer: Full Slicer seats start it through their own simplified mode. */
export const SIMPLIFIED_VIEWER_MODULE = 'SimplifiedViewer';

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
export const isApproved = (row) => !row.status || row.status === REQUEST_STATUS.APPROVED;

// The key changes with each upload, so it versions the URL: a new icon is never hidden by a cached
// old one, and editing anything else doesn't make browsers fetch the icon again.
const iconUrlOf = (doc) => (doc?.icon_key ? `/api/workflows/${doc.id}/icon?v=${encodeURIComponent(doc.icon_key.split('/').pop())}` : null);

/**
 * An approved case workflow as the API returns it. `source`, if the person can still see it, shows
 * whether it changed and gives the icon (the icon isn't copied, so it's the source's current one).
 */
export const toApproval = (row, source = null) => ({
    id: row.id,
    workflowId: row.workflow,
    name: row.name,
    description: row.description || '',
    extensions: row.extensions || [],
    fileTypes: row.file_types || [],
    startupConfig: row.startup_config || {},
    viewer: viewerOf(row),
    approvedAt: row.decided_at ?? null,
    updateAvailable: Boolean(source) && copyDiffers(row, source),
    iconUrl: iconUrlOf(source),
});

/** The parts of a workflow a case copies, in a form that compares equal when they match. */
const COPIED_FIELDS = ['name', 'description', 'extensions', 'file_types', 'startup_config', 'viewer'];
const comparable = (doc) => JSON.stringify(COPIED_FIELDS.map((field) => {
    const value = doc[field];
    if (field === 'viewer') return viewerOf(doc);
    if (field === 'startup_config') return value || {};
    if (field === 'extensions' || field === 'file_types') return value || [];
    return value || '';
}));

/**
 * Whether the source workflow has changed since the case copied it, in anything the case uses.
 * Edits that don't affect the copy (visibility, icon) aren't an update.
 */
export const copyDiffers = (row, source) => comparable(row) !== comparable(source);

/** What a case keeps of a workflow: copied on request and again on approval. */
export const workflowCopy = (source) => ({
    workflow: String(source.id),
    name: source.name,
    description: source.description || '',
    extensions: source.extensions || [],
    file_types: source.file_types || [],
    startup_config: source.startup_config || {},
    viewer: viewerOf(source),
});

/** At most 200 rows: for lists bounded by one person or one case (public workflows are paged). */
export async function findAll(collection, where, sort) {
    const { docs } = await getPayloadClient().find({ collection, where, sort, depth: 0, limit: 200 });
    return docs;
}

export const myWorkflows = (req) => findAll(WORKFLOWS, { owner_id: { equals: requireOwnerId(req) } }, 'name');
export const PUBLIC = { visibility: { equals: VISIBILITY.PUBLIC } }; // not frozen: Payload may rewrite a where in place

export const WORKFLOW_PAGE_SIZE = 24;
const MAX_PAGE = 1000;
/** Sort orders a list can ask for; the id breaks ties, so paging never repeats or skips a row. */
const WORKFLOW_SORTS = Object.freeze({
    title: ['name', 'id'],
    newest: ['-updatedAt', '-id'],
    oldest: ['updatedAt', 'id'],
});

/** A list request's search, sort and page (?q=&sort=&page=), made safe; unknown values fall back. */
export function workflowPageQuery(query = {}) {
    const page = Number.parseInt(query.page, 10);
    return {
        q: String(query.q || '').trim().slice(0, 100),
        sort: Object.hasOwn(WORKFLOW_SORTS, query.sort) ? query.sort : 'title',
        page: Number.isFinite(page) ? Math.min(Math.max(page, 1), MAX_PAGE) : 1,
    };
}

/**
 * One page of the workflows matching `where`, searched by `q` (every word must appear in the name,
 * description, extensions or file types; payload/collections.js workflowSearchText).
 * @returns {Promise<{ docs: object[], hasMore: boolean }>}
 */
export async function findWorkflowPage(where, { q, sort, page }) {
    const result = await getPayloadClient().find({
        collection: WORKFLOWS,
        where: q ? { and: [where, { search_text: { like: q } }] } : where,
        sort: WORKFLOW_SORTS[sort],
        page,
        limit: WORKFLOW_PAGE_SIZE,
        depth: 0,
    });
    return { docs: result.docs, hasMore: Boolean(result.hasNextPage) };
}

/** A workflow as the API returns it (never its owner_id). */
export const toWorkflow = (doc, req) => ({
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    visibility: doc.visibility,
    extensions: doc.extensions || [],
    fileTypes: doc.file_types || [],
    startupConfig: doc.startup_config || {},
    viewer: viewerOf(doc),
    isMine: isOwner(doc, req),
    iconUrl: iconUrlOf(doc),
    updatedAt: doc.updatedAt,
});
