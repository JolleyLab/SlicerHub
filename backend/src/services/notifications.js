/**
 * In-app notifications (Cases invites, etc.). Product runtime — not an IdP.
 */

import db from '../db/database.js';

export function createNotification({
    userId,
    type,
    title,
    body = null,
    caseId = null,
    inviteId = null
}) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid < 1) return null;
    const result = db.prepare(`
        INSERT INTO user_notifications (user_id, type, title, body, case_id, invite_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        uid,
        String(type || 'info'),
        String(title || '').slice(0, 240),
        body != null ? String(body).slice(0, 2000) : null,
        caseId != null ? String(caseId) : null,
        inviteId != null ? Number(inviteId) : null
    );
    return getNotificationById(result.lastInsertRowid);
}

export function getNotificationById(id) {
    return db.prepare(`
        SELECT id, user_id, type, title, body, case_id, invite_id, read_at, created_at
        FROM user_notifications
        WHERE id = ?
    `).get(id) || null;
}

export function listNotificationsForUser(userId, { limit = 50, unreadOnly = false } = {}) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid < 1) return [];
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    if (unreadOnly) {
        return db.prepare(`
            SELECT id, user_id, type, title, body, case_id, invite_id, read_at, created_at
            FROM user_notifications
            WHERE user_id = ? AND read_at IS NULL
            ORDER BY created_at DESC
            LIMIT ?
        `).all(uid, lim);
    }
    return db.prepare(`
        SELECT id, user_id, type, title, body, case_id, invite_id, read_at, created_at
        FROM user_notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(uid, lim);
}

export function markNotificationRead(userId, notificationId) {
    const uid = Number(userId);
    const nid = Number(notificationId);
    if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(nid)) return false;
    const result = db.prepare(`
        UPDATE user_notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND read_at IS NULL
    `).run(nid, uid);
    return result.changes > 0;
}

export function markAllNotificationsRead(userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid < 1) return 0;
    const result = db.prepare(`
        UPDATE user_notifications
        SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND read_at IS NULL
    `).run(uid);
    return result.changes;
}

export function unreadNotificationCount(userId) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid < 1) return 0;
    const row = db.prepare(`
        SELECT COUNT(*) AS c FROM user_notifications
        WHERE user_id = ? AND read_at IS NULL
    `).get(uid);
    return Number(row?.c) || 0;
}

/**
 * Permanently remove one notification from the user's inbox (manual dismiss).
 * Does not cancel the underlying invite / work item.
 */
export function deleteNotificationForUser(userId, notificationId) {
    const uid = Number(userId);
    const nid = Number(notificationId);
    if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(nid) || nid < 1) {
        return false;
    }
    const result = db.prepare(`
        DELETE FROM user_notifications
        WHERE id = ? AND user_id = ?
    `).run(nid, uid);
    return result.changes > 0;
}

export function deleteNotificationsForInviteIds(inviteIds) {
    const ids = (Array.isArray(inviteIds) ? inviteIds : [inviteIds])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`
        DELETE FROM user_notifications
        WHERE invite_id IN (${placeholders})
    `).run(...ids);
    return result.changes || 0;
}
