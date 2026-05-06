import User from '../models/User.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';

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
}
