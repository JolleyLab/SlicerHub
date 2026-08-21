/**
 * App session cookies + JWT issue — independent of identity provider.
 * Routes and providers both rely on this for a consistent cookie contract.
 */

import jwt from 'jsonwebtoken';
import {
    generateToken,
    storeSession,
    deleteSession,
    decodeToken
} from '../middleware/authMiddleware.js';

const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function authCookieOptions() {
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

export function clearAuthCookie(res) {
    const secure = process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
    res.clearCookie('token', {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/'
    });
}

/**
 * Issue JWT, persist session row, set httpOnly cookie.
 * @returns {{ user: object, token: string, sessionPayload: { jti: string, exp: number } }}
 */
export function issueAppSession(req, res, user) {
    const token = generateToken(user);
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();

    storeSession(
        user.id,
        decoded.jti,
        expiresAt,
        req.get('user-agent')
    );

    res.cookie('token', token, authCookieOptions());

    return {
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            mustChangePassword: Boolean(user.mustChangePassword),
            preferences: user.preferences
        },
        token,
        sessionPayload: {
            jti: decoded.jti,
            exp: decoded.exp
        }
    };
}

/**
 * Invalidate current browser session if present.
 * @returns {string|null} jti that was cleared
 */
export function destroyAppSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;
    let jti = null;

    if (token) {
        const decoded = decodeToken(token);
        if (decoded?.jti) {
            jti = decoded.jti;
            deleteSession(decoded.jti);
        }
    }

    clearAuthCookie(res);
    return jti;
}

/**
 * Replace current JWT (refresh) — drops old jti.
 * @returns {{ user: object, sessionPayload: object, previousJti: string|null }}
 */
export function rotateAppSession(req, res, user) {
    const authHeader = req.headers['authorization'];
    const oldToken = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;
    let previousJti = null;

    if (oldToken) {
        const oldDecoded = decodeToken(oldToken);
        if (oldDecoded?.jti) {
            previousJti = oldDecoded.jti;
            deleteSession(oldDecoded.jti);
        }
    }

    const { sessionPayload } = issueAppSession(req, res, user);
    return { user, sessionPayload, previousJti };
}
