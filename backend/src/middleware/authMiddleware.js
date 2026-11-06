import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import config from '../config/index.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { getCurrentAccount } from '../auth/accountRefresh.js';
import { isAppUserGateReady } from '../services/appUserGate.js';

/**
 * What an account still waiting for approval may call: who am I (to show the
 * "Access pending approval" screen), sign out, and its theme preference.
 */
const PENDING_ALLOWED = [
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/activity'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/logout-all'],
    ['PUT', '/api/auth/preferences'],
];

function pendingMayCall(req) {
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    const method = String(req.method || '').toUpperCase();
    return PENDING_ALLOWED.some(([m, p]) => m === method && p === path);
}

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
const SESSION_MAX_SECONDS = config.security.sessionMaxHours * 60 * 60;

/**
 * Generate JWT token for a user
 */
export function generateToken(user, { expiresInSeconds = null, issuedAt = null } = {}) {
    const payload = {
        // A re-issued session keeps its original sign-in time, so the 12 h limit counts
        // from the password, not from the last profile update.
        ...(issuedAt ? { iat: issuedAt } : {}),
        userId: user.id,
        username: user.username,
        role: user.role,
        ...(user.keycloakSub  ? { keycloakSub:  user.keycloakSub  } : {}),
        ...(user.firstName    ? { firstName:    user.firstName    } : {}),
        ...(user.lastName     ? { lastName:     user.lastName     } : {}),
        // Approval gate (Keycloak app-user). Only written when false, so tokens
        // issued before the gate existed read as approved.
        ...(user.approved === false ? { approved: false } : {}),
    };

    const token = jwt.sign(payload, JWT_SECRET, {
        // Normal sessions: SESSION_MAX_HOURS. Procedure mode: until the procedure ends.
        expiresIn: expiresInSeconds || JWT_EXPIRES_IN,
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
export async function authenticateToken(req, res, next) {
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
        const session = db.prepare('SELECT id, last_activity, procedure_until, procedure_open_ended FROM sessions WHERE token_jti = ?')
            .get(decoded.jti);

        if (!session) {
            scheduleLocalViewerCleanup(decoded.userId, 'invalid-session');
            throw new UnauthorizedError(msg('auth.session_invalid'), null, 'auth.session_invalid');
        }

        // Session rules (docs/redirect-login-and-sessions-design.md, "Sessions"):
        //   procedure mode — exempt from idle and the 12 h limit until procedure_until,
        //                    then over (the workstation is not left signed in);
        //   otherwise      — 30 min idle, where only real use counts (POST /api/auth/activity
        //                    from the page, not background polling), and 12 h from sign-in.
        const procedureUntilMs = session.procedure_until ? parseDbTime(session.procedure_until) : null;
        if (procedureUntilMs) {
            if (Date.now() >= procedureUntilMs) {
                db.prepare('DELETE FROM sessions WHERE token_jti = ?').run(decoded.jti);
                throw new UnauthorizedError(msg('auth.procedure_mode_ended'), 'PROCEDURE_MODE_ENDED', 'auth.procedure_mode_ended');
            }
        } else {
            const lastActivityMs = session.last_activity ? parseDbTime(session.last_activity) : 0;
            const idleLimitMs = SESSION_IDLE_MINUTES * 60 * 1000;
            if (!lastActivityMs || (Date.now() - lastActivityMs) > idleLimitMs) {
                db.prepare('DELETE FROM sessions WHERE token_jti = ?').run(decoded.jti);
                scheduleLocalViewerCleanup(decoded.userId, 'idle-timeout');
                throw new UnauthorizedError(msg('auth.session_inactivity_timeout'), 'SESSION_IDLE', 'auth.session_inactivity_timeout');
            }
            // Also covers tokens issued before the 12 h limit (they carried 7 days).
            if (Number(decoded.iat) && (Date.now() / 1000 - Number(decoded.iat)) > SESSION_MAX_SECONDS) {
                db.prepare('DELETE FROM sessions WHERE token_jti = ?').run(decoded.jti);
                throw new UnauthorizedError(msg('auth.token_expired'), 'SESSION_MAX_AGE', 'auth.token_expired');
            }
        }

        // The role in the token is from login time. Re-check it against Keycloak
        // (cached, see auth/accountRefresh.js) so demotions and disabled accounts take
        // effect within minutes instead of lasting as long as the user stays active.
        let role = decoded.role;
        let approved = decoded.approved !== false;
        if (decoded.keycloakSub && config.auth?.provider === 'keycloak') {
            const account = await getCurrentAccount(decoded.keycloakSub);
            if (account.active === false) {
                deleteAllUserSessions(decoded.userId);
                throw new UnauthorizedError(msg('auth.session_invalid'), null, 'auth.session_invalid');
            }
            // Keycloak's "log out user" stamps notBefore on the account: sessions
            // signed in before it are over. Both are whole seconds, so a session from the
            // same second counts as before (safer: at worst one extra sign-in).
            if (account.notBefore && Number(decoded.iat) <= account.notBefore) {
                deleteSession(decoded.jti);
                throw new UnauthorizedError(msg('auth.session_invalid'), null, 'auth.session_invalid');
            }
            if (account.active === true) {
                role = account.role;
                approved = account.approved === true;
            }
        }

        // Approval gate: until a reviewer grants app-user, an account can only see the
        // "Access pending approval" screen. The gate stays open until the one-off grant
        // of app-user to existing accounts is confirmed (services/appUserGate.js), so
        // existing users are never shut out by the deploy order.
        if (!approved && !isAppUserGateReady()) approved = true;
        if (!approved && !pendingMayCall(req)) {
            throw new ForbiddenError(msg('auth.access_pending'), 'ACCESS_PENDING', 'auth.access_pending');
        }

        // No sliding window here: background requests (polling, heartbeats) must not keep
        // an unattended session alive. The page reports real use via POST /api/auth/activity.

        // Attach user info to request
        req.user = {
            id: decoded.userId,
            username: decoded.username,
            role,
            approved,
            jti: decoded.jti,
            sessionId: session.id,
            iat: Number(decoded.iat) || null,
            procedureUntil: procedureUntilMs ? new Date(procedureUntilMs).toISOString() : null,
            procedureOpenEnded: Boolean(session.procedure_open_ended),
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
export function storeSession(userId, tokenJti, expiresAt, userAgent, {
    kcSid = null, idTokenEnc = null, procedureUntil = null, procedureOpenEnded = false,
} = {}) {
    db.prepare(`
        INSERT INTO sessions (user_id, token_jti, expires_at, last_activity, user_agent, kc_sid, id_token_enc, procedure_until, procedure_open_ended)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `).run(userId, tokenJti, expiresAt, userAgent, kcSid, idTokenEnc, procedureUntil, procedureOpenEnded ? 1 : 0);
}

/** Real use reported by the page: slides the idle window. */
export function touchSessionActivity(sessionId) {
    db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
}

/** End procedure mode on a session: back to normal rules, idle window restarts now. */
export function clearSessionProcedure(sessionId) {
    db.prepare('UPDATE sessions SET procedure_until = NULL, procedure_open_ended = 0, last_activity = CURRENT_TIMESTAMP WHERE id = ?')
        .run(sessionId);
}

/**
 * SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker;
 * ISO strings (procedure_until) carry one. Parse both as UTC.
 */
function parseDbTime(value) {
    const s = String(value || '');
    if (!s) return 0;
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}

/**
 * What a re-issued session (profile update, refresh) carries over from the current one:
 * the Keycloak link { kcSid, idTokenEnc } and procedure mode { procedureUntil,
 * procedureOpenEnded }. Nulls/false when there is no such session.
 */
export function getSessionOidc(tokenJti) {
    const empty = { kcSid: null, idTokenEnc: null, procedureUntil: null, procedureOpenEnded: false };
    if (!tokenJti) return empty;
    const row = db.prepare('SELECT kc_sid, id_token_enc, procedure_until, procedure_open_ended FROM sessions WHERE token_jti = ?').get(tokenJti);
    if (!row) return empty;
    return {
        kcSid: row.kc_sid || null,
        idTokenEnc: row.id_token_enc || null,
        procedureUntil: row.procedure_until || null,
        procedureOpenEnded: Boolean(row.procedure_open_ended),
    };
}

/** End every app session tied to a Keycloak session (back-channel logout). Returns rows deleted. */
export function deleteSessionsByKcSid(kcSid) {
    if (!kcSid) return 0;
    return db.prepare('DELETE FROM sessions WHERE kc_sid = ?').run(kcSid)?.changes ?? 0;
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
