/**
 * Resolve a Directus user access token for the current app session ("call as user").
 * Fail closed for Cases: never fall back to the service token.
 *
 * Durable refresh across session jti changes: encrypted httpOnly `dx_link` cookie
 * (see directusLinkCookie.js). Session-scoped SQLite is only for the active jti.
 */

import {
    getProviderTokens,
    storeProviderTokens
} from './identityStore.js';
import {
    getDirectusLinkCookie,
    setDirectusLinkCookie,
    clearDirectusLinkCookie
} from './directusLinkCookie.js';
import { UnauthorizedError, ForbiddenError, AppError } from '../utils/errors.js';
import config from '../config/index.js';
import { msg } from '../i18n/index.js';

const PROVIDER = 'directus';
const REFRESH_SKEW_MS = 60 * 1000;

function directusBaseUrl() {
    return (config.directus.url || '').trim().replace(/\/+$/, '');
}

function expiresAtMs(tokens) {
    if (!tokens?.expires_at && !tokens?.expiresAt) return null;
    const t = new Date(tokens.expires_at || tokens.expiresAt).getTime();
    return Number.isFinite(t) ? t : null;
}

function accessLooksExpired(tokens) {
    const exp = expiresAtMs(tokens);
    if (exp == null) {
        return false;
    }
    return Date.now() >= exp - REFRESH_SKEW_MS;
}

function expiresAtFromDirectus(expires) {
    if (expires == null) return null;
    const n = Number(expires);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 10 * 24 * 3600 ? n : n * 1000;
    return new Date(Date.now() + ms).toISOString();
}

async function refreshDirectusAccess(refreshToken) {
    const base = directusBaseUrl();
    if (!base) {
        throw new AppError(msg('directus.url_not_configured'), 503, null, 'directus.url_not_configured');
    }

    const res = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({
            refresh_token: refreshToken,
            mode: 'json'
        })
    });

    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    if (!res.ok) {
        return null;
    }

    const data = body?.data || body;
    const accessToken = data?.access_token;
    if (!accessToken) return null;

    return {
        accessToken,
        refreshToken: data?.refresh_token || refreshToken,
        expires: data?.expires,
        expiresAt: expiresAtFromDirectus(data?.expires)
    };
}

function persistSessionAndCookie(res, tokenJti, userId, next) {
    storeProviderTokens(tokenJti, userId, PROVIDER, next);
    if (res) {
        setDirectusLinkCookie(res, {
            userId,
            accessToken: next.accessToken || next.access_token,
            refreshToken: next.refreshToken || next.refresh_token,
            expiresAt: next.expiresAt || next.expires_at || expiresAtFromDirectus(next.expires)
        });
    }
}

/**
 * Attach Directus tokens from the browser link cookie onto a new app session jti
 * (session rotate / re-issue). No-ops if Cases token store is off or cookie absent.
 * @returns {Promise<boolean>} true if this session now has Directus tokens
 */
export async function attachStoredDirectusTokensToSession(req, res, tokenJti, userId) {
    if (!tokenJti || !userId) return false;
    if (config.auth?.storeProviderTokens !== true) return false;
    if (!directusBaseUrl()) return false;

    const existing = getProviderTokens(tokenJti);
    if (existing?.access_token || existing?.refresh_token) {
        return true;
    }

    const linked = getDirectusLinkCookie(req);
    if (!linked || linked.userId !== Number(userId)) {
        return false;
    }

    if (linked.refreshToken) {
        const next = await refreshDirectusAccess(linked.refreshToken);
        if (next?.accessToken) {
            persistSessionAndCookie(res, tokenJti, userId, next);
            return true;
        }
        clearDirectusLinkCookie(res);
        return false;
    }

    if (linked.accessToken && !accessLooksExpired({ expires_at: linked.expiresAt })) {
        persistSessionAndCookie(res, tokenJti, userId, {
            accessToken: linked.accessToken,
            refreshToken: null,
            expiresAt: linked.expiresAt
        });
        return true;
    }

    return false;
}

/**
 * @param {{ jti?: string, id?: number }} appUser
 * @param {{ forceRefresh?: boolean, req?: object, res?: object }} [options]
 * @returns {Promise<string>} Directus access token
 */
export async function getDirectusAccessTokenForAppUser(appUser, { forceRefresh = false, req = null, res = null } = {}) {
    const jti = appUser?.jti;
    const userId = appUser?.id;
    if (!jti || !userId) {
        throw new UnauthorizedError(
            msg('directus.session_incomplete'),
            'DIRECTUS_SESSION_REQUIRED',
            'directus.session_incomplete'
        );
    }

    if (!directusBaseUrl()) {
        throw new AppError(msg('directus.url_not_configured'), 503, null, 'directus.url_not_configured');
    }

    let tokens = getProviderTokens(jti);
    if (!tokens?.access_token && !tokens?.refresh_token && req) {
        const attached = await attachStoredDirectusTokensToSession(req, res, jti, userId);
        tokens = attached ? getProviderTokens(jti) : null;
    }

    if (!tokens?.access_token && !tokens?.refresh_token) {
        throw new ForbiddenError(
            msg('directus.session_sign_in_once'),
            'DIRECTUS_SESSION_REQUIRED',
            'directus.session_sign_in_once'
        );
    }

    if (forceRefresh) {
        if (!tokens.refresh_token) {
            throw new ForbiddenError(
                msg('directus.session_expired'),
                'DIRECTUS_SESSION_EXPIRED',
                'directus.session_expired'
            );
        }
        const next = await refreshDirectusAccess(tokens.refresh_token);
        if (!next?.accessToken) {
            clearDirectusLinkCookie(res);
            throw new ForbiddenError(
                msg('directus.session_expired'),
                'DIRECTUS_SESSION_EXPIRED',
                'directus.session_expired'
            );
        }
        persistSessionAndCookie(res, jti, userId, next);
        return next.accessToken;
    }

    if (tokens.access_token && !accessLooksExpired(tokens)) {
        return tokens.access_token;
    }

    if (tokens.refresh_token) {
        const next = await refreshDirectusAccess(tokens.refresh_token);
        if (next?.accessToken) {
            persistSessionAndCookie(res, jti, userId, next);
            return next.accessToken;
        }
        clearDirectusLinkCookie(res);
    }

    if (tokens.access_token) {
        return tokens.access_token;
    }

    throw new ForbiddenError(
        msg('directus.session_expired'),
        'DIRECTUS_SESSION_EXPIRED',
        'directus.session_expired'
    );
}

/**
 * Async middleware: after authenticateToken (+ optional requireDirectusLink).
 * Sets req.directusAccessToken.
 * Always refreshes the Directus access token when a refresh_token is stored so
 * role/policy edits apply on the next Cases request (not only after JWT expiry).
 */
export async function requireDirectusUserToken(req, res, next) {
    try {
        const accessToken = await getDirectusAccessTokenForAppUser(req.user, {
            forceRefresh: true,
            req,
            res
        });
        req.directusAccessToken = accessToken;
        next();
    } catch (err) {
        next(err);
    }
}
