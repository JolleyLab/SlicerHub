/**
 * App session cookies + JWT issue — independent of identity provider.
 * Routes and providers both rely on this for a consistent cookie contract.
 */

import jwt from 'jsonwebtoken';
import {
    generateToken,
    storeSession,
    endSession,
    decodeToken,
    getSessionOidc
} from '../middleware/authMiddleware.js';

const DEFAULT_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Session cookie options; maxAge follows the token's own lifetime. */
export function authCookieOptions({ maxAgeMs = DEFAULT_COOKIE_MAX_AGE_MS } = {}) {
    const secure = process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
    return {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: Math.max(0, maxAgeMs)
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
 *
 * options (all optional):
 *   kcSid, idTokenEnc            — redirect (OIDC) login link to the Keycloak session
 *   procedureUntil (ISO), procedureOpenEnded — procedure mode
 *   issuedAt (seconds)           — keep an existing sign-in time (re-issue)
 * With no options, re-issuing for a signed-in user (profile update) carries over the
 * current session's Keycloak link, procedure mode and sign-in time.
 *
 * @returns {{ user: object, token: string, sessionPayload: { jti: string, exp: number } }}
 */
export function issueAppSession(req, res, user, options = null) {
    const carried = options || {
        ...getSessionOidc(req.user?.jti),
        issuedAt: req.user?.iat || null,
    };
    const {
        kcSid = null, idTokenEnc = null,
        procedureUntil = null, procedureOpenEnded = false,
        issuedAt = null,
    } = carried;

    // Procedure mode: the token lives until the procedure ends; otherwise SESSION_MAX_HOURS.
    const procedureMs = procedureUntil ? Date.parse(procedureUntil) : null;
    const expiresInSeconds = procedureMs
        ? Math.max(60, Math.ceil((procedureMs - (issuedAt ? issuedAt * 1000 : Date.now())) / 1000))
        : null;
    const token = generateToken(user, { expiresInSeconds, issuedAt });
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();

    // No user agent: nothing reads it, so it is not stored (privacy minimization).
    storeSession(user.id, decoded.jti, expiresAt, null, {
        kcSid, idTokenEnc,
        procedureUntil: procedureMs ? new Date(procedureMs).toISOString() : null,
        procedureOpenEnded,
    });

    res.cookie('token', token, authCookieOptions({ maxAgeMs: decoded.exp * 1000 - Date.now() }));

    return {
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.firstName || user.first_name || null,
            lastName: user.lastName || user.last_name || null,
            displayName: (() => {
                const first = String(user.firstName || user.first_name || '').trim();
                const last = String(user.lastName || user.last_name || '').trim();
                const full = `${first} ${last}`.trim();
                return full || user.email || user.username || 'Guest';
            })(),
            role: user.role,
            approved: user.approved !== false,
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
            endSession(decoded.jti);
        }
    }

    clearAuthCookie(res);
    return jti;
}
