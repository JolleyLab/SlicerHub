/**
 * In-app notifications (bell + Home "To do"), e.g. @mentions in case comments.
 * Notifications are keyed by the app user id (the Keycloak sub) and stored in Payload
 * (services/notifications.js).
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
    listNotificationsForUser,
    markNotificationRead,
    markAllNotificationsRead,
    unreadNotificationCount,
    newNotificationCount,
    markNotificationsSeen,
    deleteNotificationForUser,
    getBellOpenedAt,
    markBellOpened,
} from '../services/notifications.js';

export default function notificationRoutes(app) {
    app.get('/api/notifications', authenticateToken, asyncHandler(async (req, res) => {
        const unreadOnly = String(req.query.unread || '') === '1';
        const [notifications, unreadCount, newCount, bellOpenedAt] = await Promise.all([
            listNotificationsForUser(req.user.id, { unreadOnly }),
            unreadNotificationCount(req.user.id),
            newNotificationCount(req.user.id),
            getBellOpenedAt(req.user.keycloakSub),
        ]);
        res.set('Cache-Control', 'no-store');
        // bellOpenedAt: to-dos (registrations, invites, workflow requests) that arrived before it
        // stay listed in the bell but don't light its dot.
        res.json({ notifications, unreadCount, newCount, bellOpenedAt });
    }));

    /** The bell was opened: clears its dot (notifications and to-dos); everything stays listed. */
    app.post('/api/notifications/seen', authenticateToken, asyncHandler(async (req, res) => {
        const [seen, bellOpenedAt] = await Promise.all([
            markNotificationsSeen(req.user.id),
            markBellOpened(req.user.keycloakSub),
        ]);
        res.json({ ok: true, seen, newCount: 0, bellOpenedAt });
    }));

    app.post('/api/notifications/read-all', authenticateToken, asyncHandler(async (req, res) => {
        const updated = await markAllNotificationsRead(req.user.id);
        res.json({ ok: true, updated, unreadCount: 0 });
    }));

    app.post('/api/notifications/:id/read', authenticateToken, asyncHandler(async (req, res) => {
        await markNotificationRead(req.user.id, req.params.id);
        res.json({ ok: true, unreadCount: await unreadNotificationCount(req.user.id) });
    }));

    /** Remove from inbox only — does not cancel pending invites / work. */
    app.delete('/api/notifications/:id', authenticateToken, asyncHandler(async (req, res) => {
        const removed = await deleteNotificationForUser(req.user.id, req.params.id);
        res.json({ ok: true, removed, unreadCount: await unreadNotificationCount(req.user.id) });
    }));
}
