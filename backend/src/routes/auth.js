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

export default function authRoutes(app) {
    /**
     * Register new user
     */
    app.post('/api/auth/register', asyncHandler(async (req, res) => {
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
            req.ip,
            req.get('user-agent')
        );

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

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
    app.post('/api/auth/login', asyncHandler(async (req, res) => {
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
            req.ip,
            req.get('user-agent')
        );

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

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
    app.post('/api/auth/logout', authenticateToken, asyncHandler(async (req, res) => {
        // Stop any running containers for this user
        try {
            const containerManager = require('../docker/containerManager');
            await containerManager.stopContainer(req.user.userId);
        } catch (err) {
            // Container might not exist, continue with logout
            console.log('Container cleanup during logout:', err.message);
        }

        // Get token from header or cookie
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1] || req.cookies?.token;

        if (token) {
            const decoded = decodeToken(token);
            if (decoded && decoded.jti) {
                deleteSession(decoded.jti);
            }
        }

        // Clear the cookie
        res.clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

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
            req.ip,
            req.get('user-agent')
        );

        // Set new httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.json({ user });
    }));

    /**
     * Logout all sessions (security feature)
     */
    app.post('/api/auth/logout-all', authenticateToken, asyncHandler(async (req, res) => {
        deleteAllUserSessions(req.user.id);
        res.json({ message: 'All sessions terminated' });
    }));
}
