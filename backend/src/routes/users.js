import User from '../models/User.js';
import {
    authenticateToken,
    deleteAllUserSessions
} from '../middleware/authMiddleware.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { stopSlicerGuiSession } from '../slicerGui/sessionManager.js';

const LOADTEST_EMAIL_SUFFIX = '@loadtest.local';

export default function userRoutes(app) {
    /**
     * Lookup a user by exact email match.
     * Requires authentication and returns only minimal profile data.
     */
    app.get('/api/users/lookup', authenticateToken, asyncHandler(async (req, res) => {
        const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';

        if (!email) {
            throw new ValidationError('Email is required');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ValidationError('Invalid email format');
        }

        const user = User.findByEmail(email);

        if (!user) {
            throw new NotFoundError('No matching user found');
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
     * Delete a synthetic load-test account (@loadtest.local only).
     * Used by tests/full-slicer/run-multiuser-capacity.mjs cleanup.
     */
    app.delete('/api/users/:userId', authenticateToken, asyncHandler(async (req, res) => {
        const userId = Number(req.params.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new ValidationError('Invalid user id');
        }
        if (userId === Number(req.user.id)) {
            throw new ValidationError('Cannot delete the authenticated user');
        }

        const user = User.findById(userId);
        if (!user) {
            throw new NotFoundError('User not found');
        }
        const email = String(user.email || '').toLowerCase();
        if (!email.endsWith(LOADTEST_EMAIL_SUFFIX)) {
            throw new ForbiddenError(
                `Only ${LOADTEST_EMAIL_SUFFIX} load-test accounts can be deleted via this endpoint`
            );
        }
        if (user.role === 'admin') {
            throw new ForbiddenError('Cannot delete admin users via load-test cleanup');
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
