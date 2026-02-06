import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import config from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';

const { secret: JWT_SECRET, expiresIn: JWT_EXPIRES_IN } = config.jwt;

/**
 * Generate JWT token for a user
 */
export function generateToken(user) {
    const payload = {
        userId: user.id,
        username: user.username,
        role: user.role
    };

    const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        jwtid: generateJti()
    });

    return token;
}

/**
 * Generate unique JWT ID
 */
function generateJti() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Middleware to verify JWT token
 */
export function authenticateToken(req, res, next) {
    try {
        // Get token from Authorization header or cookie
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1] || req.cookies?.token;

        if (!token) {
            throw new UnauthorizedError('Access token required');
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if token is blacklisted (session deleted)
        const session = db.prepare('SELECT id FROM sessions WHERE token_jti = ?')
            .get(decoded.jti);

        if (!session) {
            throw new UnauthorizedError('Invalid or expired session');
        }

        // Attach user info to request
        req.user = {
            id: decoded.userId,
            username: decoded.username,
            role: decoded.role
        };

        next();
    } catch (error) {
        // If it's already an AppError, pass it through
        if (error.isOperational) {
            next(error);
        } else if (error.name === 'TokenExpiredError') {
            next(new UnauthorizedError('Token expired'));
        } else if (error.name === 'JsonWebTokenError') {
            next(new ForbiddenError('Invalid token'));
        } else {
            next(error);
        }
    }
}

/**
 * Middleware to check if user is admin
 */
export function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return next(new ForbiddenError('Admin access required'));
    }
    next();
}

/**
 * Store session in database
 */
export function storeSession(userId, tokenJti, expiresAt, ipAddress, userAgent) {
    db.prepare(`
        INSERT INTO sessions (user_id, token_jti, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, tokenJti, expiresAt, ipAddress, userAgent);
}

/**
 * Delete session (logout)
 */
export function deleteSession(tokenJti) {
    db.prepare('DELETE FROM sessions WHERE token_jti = ?').run(tokenJti);
}

/**
 * Delete all sessions for a user
 */
export function deleteAllUserSessions(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/**
 * Clean up expired sessions
 */
export function cleanExpiredSessions() {
    db.prepare('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP').run();
}

// Clean up expired sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

/**
 * Decode token without verification (for getting jti to logout)
 */
export function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch {
        return null;
    }
}
