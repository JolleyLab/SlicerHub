import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import config from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

/**
 * Intentionally a no-op for single-session expiry.
 * Killing all Full Slicer seats here used to disrupt other browsers for the
 * same user. Orphaned seats are reaped by the viewer lease watchdog / TTL.
 */
function scheduleLocalViewerCleanup(_userId, _reason) {
    /* no-op: multi-seat safe */
}

const { secret: JWT_SECRET, expiresIn: JWT_EXPIRES_IN } = config.jwt;
const SESSION_IDLE_MINUTES = config.security.sessionIdleMinutes;

/**
 * Generate JWT token for a user
 */
export function generateToken(user) {
    const payload = {
        userId: user.id,
        username: user.username,
        role: user.role,
        ...(user.keycloakSub  ? { keycloakSub:  user.keycloakSub  } : {}),
        ...(user.firstName    ? { firstName:    user.firstName    } : {}),
        ...(user.lastName     ? { lastName:     user.lastName     } : {}),
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
    return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
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
            throw new UnauthorizedError(msg('auth.access_token_required'), null, 'auth.access_token_required');
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if token is blacklisted (session deleted)
        const session = db.prepare('SELECT id, last_activity FROM sessions WHERE token_jti = ?')
            .get(decoded.jti);

        if (!session) {
            scheduleLocalViewerCleanup(decoded.userId, 'invalid-session');
            throw new UnauthorizedError(msg('auth.session_invalid'), null, 'auth.session_invalid');
        }

        // Enforce idle timeout server-side.
        const lastActivityMs = session.last_activity ? new Date(session.last_activity).getTime() : 0;
        const idleLimitMs = SESSION_IDLE_MINUTES * 60 * 1000;
        if (!lastActivityMs || (Date.now() - lastActivityMs) > idleLimitMs) {
            db.prepare('DELETE FROM sessions WHERE token_jti = ?').run(decoded.jti);
            scheduleLocalViewerCleanup(decoded.userId, 'idle-timeout');
            throw new UnauthorizedError(msg('auth.session_inactivity_timeout'), null, 'auth.session_inactivity_timeout');
        }

        // Sliding activity window: refresh activity timestamp on each valid request.
        db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?')
            .run(session.id);

        // Attach user info to request
        req.user = {
            id: decoded.userId,
            username: decoded.username,
            role: decoded.role,
            jti: decoded.jti,
            keycloakSub: decoded.keycloakSub || null,
            firstName: decoded.firstName || null,
            lastName: decoded.lastName || null,
        };

        next();
    } catch (error) {
        // If it's already an AppError, pass it through
        if (error.isOperational) {
            next(error);
        } else if (error.name === 'TokenExpiredError') {
            const authHeader = req.headers['authorization'];
            const rawToken = authHeader && authHeader.split(' ')[1] || req.cookies?.token;
            const decoded = decodeToken(rawToken);
            if (decoded?.jti) {
                deleteSession(decoded.jti);
            }
            scheduleLocalViewerCleanup(decoded?.userId, 'token-expired');
            next(new UnauthorizedError(msg('auth.token_expired'), null, 'auth.token_expired'));
        } else if (error.name === 'JsonWebTokenError') {
            next(new UnauthorizedError(msg('auth.session_expired'), null, 'auth.session_expired'));
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
        return next(new ForbiddenError(msg('auth.admin_required'), null, 'auth.admin_required'));
    }
    next();
}

/**
 * Store session in database
 */
export function storeSession(userId, tokenJti, expiresAt, userAgent) {
    db.prepare(`
        INSERT INTO sessions (user_id, token_jti, expires_at, last_activity, user_agent)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
    `).run(userId, tokenJti, expiresAt, userAgent);
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
