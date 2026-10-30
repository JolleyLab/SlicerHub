import User from '../models/User.js';
import {
    authenticateToken,
    deleteAllUserSessions
} from '../middleware/authMiddleware.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { stopSlicerGuiSession } from '../slicerGui/sessionManager.js';
import { msg } from '../i18n/index.js';
import storage from '../storage/index.js';

const AVATAR_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

const LOADTEST_EMAIL_SUFFIX = '@loadtest.local';

export default function userRoutes(app) {
    /**
     * Lookup a user by exact email match.
     * Requires authentication and returns only minimal profile data.
     */
    app.get('/api/users/lookup', authenticateToken, asyncHandler(async (req, res) => {
        const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

        if (!email) {
            throw new ValidationError(msg('user.email_required'), null, 'user.email_required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ValidationError(msg('auth.invalid_email'), null, 'auth.invalid_email');
        }

        const user = User.findByEmail(email);

        if (!user) {
            throw new NotFoundError(msg('user.not_found_by_email'), null, 'user.not_found_by_email');
        }

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    }));

    /**
     * Serve another user's avatar by Keycloak sub. Requires authentication.
     * Returns 404 if the sub is invalid or no avatar has been uploaded.
     */
    app.get('/api/users/:sub/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const sub = req.params.sub;
        if (!sub || sub.length > 128) return res.status(404).end();
        const prefix = storage.avatarKeyForSub(sub, '').replace(/\.$/, '');
        const keys = await storage.listByPrefix(prefix);
        const key = keys.length > 0 ? keys[0] : null;
        if (!key) return res.status(404).end();
        const presigned = await storage.getPresignedReadUrl(key, 300);
        if (presigned) return res.redirect(302, presigned);
        const ext = key.split('.').pop().toLowerCase();
        res.setHeader('Content-Type', AVATAR_MIME[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return (await storage.openReadStream(key)).pipe(res);
    }));

    /**
     * Delete a synthetic load-test account (@loadtest.local only).
     * Used by tests/full-slicer/run-multiuser-capacity.mjs cleanup.
     */
    app.delete('/api/users/:userId', authenticateToken, asyncHandler(async (req, res) => {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new ValidationError(msg('user.invalid_id'), null, 'user.invalid_id');
        }
        if (userId === Number(req.user.id)) {
            throw new ValidationError(msg('user.cannot_delete_self'), null, 'user.cannot_delete_self');
        }

        const user = User.findById(userId);
        if (!user) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }
        const email = String(user.email || '').toLowerCase();
        if (!email.endsWith(LOADTEST_EMAIL_SUFFIX)) {
            throw new ForbiddenError(
                msg('user.loadtest_delete_only', { suffix: LOADTEST_EMAIL_SUFFIX }),
                null,
                'user.loadtest_delete_only'
            );
        }
        if (user.role === 'admin') {
            throw new ForbiddenError(msg('user.cannot_delete_admin'), null, 'user.cannot_delete_admin');
        }

        try {
            await stopSlicerGuiSession({ userId });
        } catch (err) {
            console.warn(`Load-test cleanup: stop Full Slicer for user ${userId}:`, err.message);
        }
        deleteAllUserSessions(userId);
        User.delete(userId);

        res.json({
            success: true,
            deletedUserId: userId,
            username: user.username
        });
    }));
}
