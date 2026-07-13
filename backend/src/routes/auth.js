import User from '../models/User.js';
import {
    generateToken,
    storeSession,
    deleteSession,
    deleteAllUserSessions,
    decodeToken,
    authenticateToken
} from '../middleware/authMiddleware.js';
import jwt from 'jsonwebtoken';
import { ValidationError, UnauthorizedError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';

const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const authPerIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Too many authentication attempts. Please wait and try again.',
    getKey: (req) => `auth:ip:${getRateLimitClientIp(req)}`
});

const registerPerIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many registration attempts. Please wait and try again.',
    getKey: (req) => `register:ip:${getRateLimitClientIp(req)}`
});

function authCookieOptions() {
    const secure = process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
    return {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: AUTH_COOKIE_MAX_AGE_MS
    };
}

function clearAuthCookie(res) {
    const secure = process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
    res.clearCookie('token', {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/'
    });
}

export default function authRoutes(app) {
    /**
     * Register new user
     */
    app.post('/api/auth/register', registerPerIpRateLimit, asyncHandler(async (req, res) => {
        if (process.env.REGISTRATION_ENABLED === 'false') {
            throw new ValidationError('Registration is disabled on this server');
        }

        const { username, email, password } = req.body;

        // Validate input
        if (!username || !email || !password) {
            throw new ValidationError('Username, email, and password are required');
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ValidationError('Invalid email format');
        }

        // Validate password strength
        if (password.length < 8) {
            throw new ValidationError('Password must be at least 8 characters long');
        }

        // Create user
        const user = await User.create({ username, email, password });

        // Generate token
        const token = generateToken(user);
        const decoded = jwt.decode(token);

        // Store session
        const expiresAt = new Date(decoded.exp * 1000).toISOString();
        storeSession(
            user.id,
            decoded.jti,
            expiresAt,
            req.get('user-agent')
        );

        res.cookie('token', token, authCookieOptions());

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    }));

    /**
     * Login
     */
    app.post('/api/auth/login', authPerIpRateLimit, asyncHandler(async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            throw new ValidationError('Username and password are required');
        }

        // Verify credentials
        const user = await User.verifyPassword(username, password);

        if (!user) {
            throw new UnauthorizedError('Invalid credentials');
        }

        // Generate token
        const token = generateToken(user);
        const decoded = jwt.decode(token);

        // Store session
        const expiresAt = new Date(decoded.exp * 1000).toISOString();
        storeSession(
            user.id,
            decoded.jti,
            expiresAt,
            req.get('user-agent')
        );

        res.cookie('token', token, authCookieOptions());

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    }));

    /**
     * Logout
     */
    app.post('/api/auth/logout', asyncHandler(async (req, res) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1] || req.cookies?.token;

        if (token) {
            const decoded = decodeToken(token);
            if (decoded?.jti) {
                deleteSession(decoded.jti);
            }
            if (decoded?.userId) {
                try {
                    const { cleanupLocalViewerSessionsForUser } = await import('../sessions/cleanup.js');
                    await cleanupLocalViewerSessionsForUser(decoded.userId);
                } catch (err) {
                    console.log('Local viewer cleanup during logout:', err.message);
                }
            }
        }

        clearAuthCookie(res);
        res.json({ message: 'Logout successful' });
    }));

    /**
     * Get current user info
     */
    app.get('/api/auth/me', authenticateToken, asyncHandler(async (req, res) => {
        const user = User.findById(req.user.id);

        if (!user) {
            throw new NotFoundError('User not found');
        }

        res.json({ user });
    }));

    /**
     * Refresh token (optional - extends session)
     */
    app.post('/api/auth/refresh', authenticateToken, asyncHandler(async (req, res) => {
        const user = User.findById(req.user.id);

        if (!user) {
            throw new NotFoundError('User not found');
        }

        // Delete old session
        const authHeader = req.headers['authorization'];
        const oldToken = authHeader && authHeader.split(' ')[1] || req.cookies?.token;
        const oldDecoded = decodeToken(oldToken);
        if (oldDecoded && oldDecoded.jti) {
            deleteSession(oldDecoded.jti);
        }

        // Generate new token
        const token = generateToken(user);
        const decoded = jwt.decode(token);

        // Store new session
        const expiresAt = new Date(decoded.exp * 1000).toISOString();
        storeSession(
            user.id,
            decoded.jti,
            expiresAt,
            req.get('user-agent')
        );

        res.cookie('token', token, authCookieOptions());

        res.json({ user });
    }));

    /**
     * Logout all sessions (security feature)
     */
    app.post('/api/auth/logout-all', authenticateToken, asyncHandler(async (req, res) => {
        deleteAllUserSessions(req.user.id);
        try {
            const { cleanupLocalViewerSessionsForUser } = await import('../sessions/cleanup.js');
            await cleanupLocalViewerSessionsForUser(req.user.id);
        } catch (err) {
            console.log('Local viewer cleanup during logout-all:', err.message);
        }
        clearAuthCookie(res);
        res.json({ message: 'All sessions terminated' });
    }));
}
