import config from '../config/index.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { directusFetch } from '../services/directus.js';

// Human-readable action labels for Directus activity actions.
const ACTION_LABELS = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    login:  'logged in',
    logout: 'logged out',
    comment: 'commented',
    upload: 'uploaded',
    revert: 'reverted',
};

/**
 * Fetch and shape Directus activity rows for a set of collection+item pairs.
 * Returns rows sorted newest-first.
 */
// Fields that are purely internal bookkeeping — never shown to users.
const HIDDEN_FIELDS = new Set([
    'date_created', 'date_updated', 'updated_at', 'created_at',
    'user_created', 'user_updated',
    'sort', 'parent', 'case'
]);

// Human-readable labels for known fields.
const FIELD_LABELS = {
    title:       'title',
    description: 'description',
    file_id:     'file',
    name:        'name',
    status:      'status',
};

function labelField(field) {
    return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

async function fetchActivityRows(filters, { limit = 100, offset = 0 } = {}) {
    // Build an OR filter: (collection=X AND item=Y) OR (collection=A AND item=B) ...
    const orClauses = filters.map(({ collection, item }) => ({
        _and: [
            { collection: { _eq: collection } },
            { item: { _eq: String(item) } }
        ]
    }));

    // Request revision deltas inline — avoids a second round-trip.
    // revisions.delta is a nested relation on directus_activity.
    const query = {
        filter: JSON.stringify({ _or: orClauses }),
        sort: '-timestamp',
        limit,
        offset,
        fields: 'id,action,collection,item,timestamp,user'
    };

    const result = await directusFetch('/activity', { query });
    const rows = Array.isArray(result?.data) ? result.data : [];
    if (!rows.length) return [];

    // Fetch revision deltas via a direct /revisions query filtered by activity IDs.
    // The nested-field approach (revisions.delta on /activity) requires revision read
    // permission on the service token; this query pattern works even when that's absent.
    const activityIds = rows.map((r) => r.id);
    const deltaByActivityId = await fetchRevisionDeltasByActivity(activityIds);

    // For attachment create events, fetch the name of the new file via the case relation
    // (direct /items/attachment queries may be FORBIDDEN for the service token).
    const createAttachmentIds = rows
        .filter((r) => r.collection === 'attachment' && r.action === 'create')
        .map((r) => String(r.item));
    const attachmentNames = await fetchAttachmentNames(createAttachmentIds);

    // Fetch display names for all users who appear in these activity rows.
    const userIds = [...new Set(rows.map((r) => r.user).filter(Boolean))];
    const userNames = await fetchUserNames(userIds);

    return rows.map((row) => shapeRow(row, deltaByActivityId, attachmentNames, userNames));
}

async function fetchRevisionDeltasByActivity(activityIds) {
    if (!activityIds.length) return {};
    try {
        const result = await directusFetch('/revisions', {
            query: {
                'filter[activity][_in]': activityIds.join(','),
                fields: 'id,activity,delta',
                limit: String(Math.min(activityIds.length * 3, 500))
            }
        });
        const revRows = Array.isArray(result?.data) ? result.data : [];
        // Group deltas by activity ID (one activity can have multiple revisions).
        const map = {};
        for (const rev of revRows) {
            if (rev?.activity == null || !rev?.delta) continue;
            const key = String(rev.activity);
            map[key] = Object.assign(map[key] ?? {}, rev.delta);
        }
        return map;
    } catch (err) {
        console.warn('[caseActivity] revisions fetch failed:', err.message);
        return {};
    }
}

async function fetchUserNames(userIds) {
    if (!userIds.length) return {};
    try {
        const result = await directusFetch('/users', {
            query: {
                'filter[id][_in]': userIds.join(','),
                fields: 'id,first_name,last_name,email',
                limit: String(Math.min(userIds.length, 100))
            }
        });
        const map = {};
        for (const u of (Array.isArray(result?.data) ? result.data : [])) {
            if (!u?.id) continue;
            const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
                || u.email?.split('@')[0]
                || 'Unknown user';
            map[String(u.id)] = name;
        }
        return map;
    } catch (_) {
        return {};
    }
}

async function fetchAttachmentNames(attachmentIds) {
    if (!attachmentIds.length) return {};
    // Query via /items/attachment directly; if the service token lacks root-level
    // access to this collection the call will throw and we degrade gracefully.
    try {
        const result = await directusFetch('/items/attachment', {
            query: {
                'filter[id][_in]': attachmentIds.join(','),
                fields: 'id,name',
                limit: String(Math.min(attachmentIds.length, 200))
            }
        });
        const map = {};
        for (const a of (Array.isArray(result?.data) ? result.data : [])) {
            if (a?.id) map[String(a.id)] = a.name ?? null;
        }
        return map;
    } catch (_) {
        return {};
    }
}

function shapeRow(row, deltaByActivityId = {}, attachmentNames = {}, userNames = {}) {
    const mergedDelta = deltaByActivityId[String(row.id)] ?? {};

    const changedFields = Object.keys(mergedDelta)
        .filter((f) => !HIDDEN_FIELDS.has(f))
        .map(labelField);

    // Include the raw status value so the frontend can say "archived" vs "active".
    const newStatus = HIDDEN_FIELDS.has('status') ? undefined : (mergedDelta.status ?? null);

    const attachmentName = row.collection === 'attachment' && row.action === 'create'
        ? (attachmentNames[String(row.item)] ?? null)
        : null;

    const userName = row.user ? (userNames[String(row.user)] ?? null) : null;

    return {
        id:             row.id,
        action:         row.action,
        collection:     row.collection,
        item:           row.item,
        timestamp:      row.timestamp,
        changedFields,
        newStatus,
        attachmentName,
        userName,
    };
}

/**
 * Fetch the attachment items for a case so we know which attachment IDs to include.
 * Uses the service token — read-only metadata only.
 */
async function fetchAttachmentIds(caseId) {
    // Query via the case's nested relation — avoids a root-level attachment query
    // that may be FORBIDDEN when the service token lacks direct collection access.
    const result = await directusFetch('/items/case', {
        query: {
            'filter[id][_eq]': caseId,
            fields: 'id,attachments.id',
            limit: '1'
        }
    });
    const caseData = Array.isArray(result?.data) ? result.data[0] : null;
    const atts = Array.isArray(caseData?.attachments) ? caseData.attachments : [];
    return atts.map((a) => (typeof a === 'object' ? a.id : a)).filter(Boolean);
}

export default function directusCaseActivityRoutes(app) {
    if (!config.directus.casesEnabled) return;

    const collabAuth = [authenticateToken, requireDirectusLink, requireDirectusUserToken];

    // -----------------------------------------------------------------------
    // Case audit log — case-level events + attachment created/deleted events
    // -----------------------------------------------------------------------
    app.get(
        '/api/directus/cases/:caseId/activity',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { caseId } = req.params;
            if (!caseId) throw new ValidationError(msg('case.id_required'));

            const limit  = Math.min(Number(req.query.limit)  || 50, 200);
            const offset = Number(req.query.offset) || 0;

            // Always include the case itself.
            const filters = [{ collection: 'case', item: caseId }];

            // Include attachment events (create/delete = "file added / removed").
            // We fetch attachment IDs with the service token since the user token
            // may not have direct access to query the attachment collection.
            try {
                const attachmentIds = await fetchAttachmentIds(caseId);
                for (const id of attachmentIds) {
                    filters.push({ collection: 'attachment', item: id });
                }
            } catch (err) {
                console.warn('[caseActivity] could not fetch attachment ids:', err.message);
            }

            // Activity is a system table — regular user tokens can't read it.
            // Route is already authenticated; case-scoped filtering happens server-side.
            const rows = await fetchActivityRows(filters, { limit, offset });

            res.json({ activity: rows, meta: { caseId, limit, offset } });
        })
    );

    // -----------------------------------------------------------------------
    // Attachment audit log — all events on a single attachment
    // -----------------------------------------------------------------------
    app.get(
        '/api/directus/cases/:caseId/attachments/:attachmentId/activity',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { caseId, attachmentId } = req.params;
            if (!caseId || !attachmentId) throw new ValidationError(msg('case.case_attachment_ids_required'));

            const limit  = Math.min(Number(req.query.limit)  || 50, 200);
            const offset = Number(req.query.offset) || 0;

            const rows = await fetchActivityRows(
                [{ collection: 'attachment', item: attachmentId }],
                { limit, offset }
            );

            res.json({ activity: rows, meta: { caseId, attachmentId, limit, offset } });
        })
    );
}
