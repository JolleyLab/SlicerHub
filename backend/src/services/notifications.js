/**
 * In-app notifications (bell + Home "To do" / Recent), e.g. @mentions in case comments.
 *
 * Stored in the Payload `user-notifications` collection (Postgres), keyed by the app
 * user id — the Keycloak sub. This replaced the SQLite user_notifications table, which
 * only accepted the old integer user ids and so dropped every notification for
 * Keycloak accounts. Rows are returned in the same shape the SQLite store used, so the
 * routes and the SPA didn't change.
 *
 * Retention: services/dataRetention.js.
 */

import { getPayloadClient } from '../payload/index.js';

const COLLECTION = 'user-notifications';

function recipient(userId) {
    const id = String(userId ?? '').trim();
    return id || null;
}

/** Payload (Postgres) ids are integers; anything else from a URL matches nothing. */
function docId(raw) {
    const id = String(raw ?? '').trim();
    return /^\d{1,15}$/.test(id) ? Number(id) : null;
}

function toRow(doc) {
    if (!doc) return null;
    return {
        id:         doc.id,
        user_id:    doc.user_id,
        type:       doc.type,
        title:      doc.title,
        body:       doc.body ?? null,
        case_id:    doc.case_id ?? null,
        invite_id:  doc.invite_id ?? null,
        read_at:    doc.read_at ?? null,
        created_at: doc.createdAt ?? null,
    };
}

/** Never throws: a failed notification must not fail the action that caused it. */
export async function createNotification({
    userId,
    type,
    title,
    body = null,
    caseId = null,
    inviteId = null
}) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return null;
    try {
        const doc = await payload.create({
            collection: COLLECTION,
            data: {
                user_id:   uid,
                type:      String(type || 'info').slice(0, 64),
                title:     String(title || '').slice(0, 240),
                body:      body != null ? String(body).slice(0, 2000) : null,
                case_id:   caseId != null ? String(caseId) : null,
                invite_id: inviteId != null ? String(inviteId) : null,
            },
        });
        return toRow(doc);
    } catch (err) {
        console.warn('[notifications] create failed:', err?.message);
        return null;
    }
}

export async function listNotificationsForUser(userId, { limit = 50, unreadOnly = false } = {}) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return [];
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const where = unreadOnly
        ? { and: [{ user_id: { equals: uid } }, { read_at: { exists: false } }] }
        : { user_id: { equals: uid } };
    const result = await payload.find({
        collection: COLLECTION, where, sort: '-createdAt', limit: lim, depth: 0, pagination: false,
    });
    return (result.docs || []).map(toRow);
}

export async function unreadNotificationCount(userId) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return 0;
    const result = await payload.count({
        collection: COLLECTION,
        where: { and: [{ user_id: { equals: uid } }, { read_at: { exists: false } }] },
    });
    return Number(result?.totalDocs) || 0;
}

/** Only the recipient's own notification; returns whether one was marked. */
export async function markNotificationRead(userId, notificationId) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    const nid = docId(notificationId);
    if (!uid || !payload || nid == null) return false;
    const result = await payload.update({
        collection: COLLECTION,
        where: { and: [
            { id: { equals: nid } },
            { user_id: { equals: uid } },
            { read_at: { exists: false } },
        ] },
        data: { read_at: new Date().toISOString() },
    });
    return (result.docs || []).length > 0;
}

export async function markAllNotificationsRead(userId) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return 0;
    const result = await payload.update({
        collection: COLLECTION,
        where: { and: [{ user_id: { equals: uid } }, { read_at: { exists: false } }] },
        data: { read_at: new Date().toISOString() },
    });
    return (result.docs || []).length;
}

/**
 * Permanently remove one notification from the user's inbox (manual dismiss).
 * Does not cancel the underlying invite / work item.
 */
export async function deleteNotificationForUser(userId, notificationId) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    const nid = docId(notificationId);
    if (!uid || !payload || nid == null) return false;
    const result = await payload.delete({
        collection: COLLECTION,
        where: { and: [{ id: { equals: nid } }, { user_id: { equals: uid } }] },
    });
    return (result.docs || []).length > 0;
}

export async function deleteNotificationsForInviteIds(inviteIds) {
    const ids = (Array.isArray(inviteIds) ? inviteIds : [inviteIds])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean);
    const payload = getPayloadClient();
    if (!ids.length || !payload) return 0;
    const result = await payload.delete({
        collection: COLLECTION,
        where: { invite_id: { in: ids } },
    });
    return (result.docs || []).length;
}
