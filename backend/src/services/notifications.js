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
import { findByKcSub, upsertByKcSub } from '../payload/upsertByKcSub.js';

const COLLECTION = 'user-notifications';

/** The recipient's notifications, narrowed by `more`. */
const mine = (uid, ...more) => ({ and: [{ user_id: { equals: uid } }, ...more] });
const UNREAD = { read_at: { exists: false } };
const UNSEEN = { seen_at: { exists: false } };

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
        seen_at:    doc.seen_at ?? null,
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
    const where = unreadOnly ? mine(uid, UNREAD) : mine(uid);
    const result = await payload.find({
        collection: COLLECTION, where, sort: '-createdAt', limit: lim, depth: 0, pagination: false,
    });
    return (result.docs || []).map(toRow);
}

async function countMine(userId, ...more) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return 0;
    const result = await payload.count({ collection: COLLECTION, where: mine(uid, ...more) });
    return Number(result?.totalDocs) || 0;
}

export const unreadNotificationCount = (userId) => countMine(userId, UNREAD);

/** The bell's dot: unread notifications that arrived since the bell was last opened. */
export const newNotificationCount = (userId) => countMine(userId, UNREAD, UNSEEN);

/** The bell was opened: what's unread in it now is seen (still unread until clicked). */
export async function markNotificationsSeen(userId) {
    const uid = recipient(userId);
    const payload = getPayloadClient();
    if (!uid || !payload) return 0;
    const result = await payload.update({
        collection: COLLECTION,
        where: mine(uid, UNREAD, UNSEEN),
        data: { seen_at: new Date().toISOString() },
    });
    return (result.docs || []).length;
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
        where: mine(uid, UNREAD),
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

// ── When the bell was last opened (bell-state): to-dos older than this don't light its dot ──

const BELL_STATE = 'bell-state';

/** When the user last opened the bell (ISO string), or null. */
export async function getBellOpenedAt(kcSub) {
    if (!getPayloadClient() || !kcSub) return null;
    try {
        return (await findByKcSub(BELL_STATE, kcSub))?.opened_at ?? null;
    } catch (err) {
        console.warn('[notifications] getBellOpenedAt failed:', err.message);
        return null;
    }
}

/** Record that the user opened the bell now; returns the time stored. */
export async function markBellOpened(kcSub) {
    if (!getPayloadClient() || !kcSub) return null;
    const at = new Date().toISOString();
    await upsertByKcSub(BELL_STATE, kcSub, { opened_at: at });
    return at;
}
