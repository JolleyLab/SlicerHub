/**
 * Resolve a Directus user access token for the current app session ("call as user").
 * Fail closed for Cases: never fall back to the service token.
 */

import config from '../config/index.js';
import {
    getProviderTokens,
    storeProviderTokens
} from './identityStore.js';
import { UnauthorizedError, ForbiddenError, AppError } from '../utils/errors.js';

const PROVIDER = 'directus';
const REFRESH_SKEW_MS = 60 * 1000;

function directusBaseUrl() {
    return (config.directus.url || '').trim().replace(/\/+$/, '');
}

function expiresAtMs(tokens) {
    if (!tokens?.expires_at) return null;
    const t = new Date(tokens.expires_at).getTime();
    return Number.isFinite(t) ? t : null;
}

function accessLooksExpired(tokens) {
    const exp = expiresAtMs(tokens);
    if (exp == null) {
        // Unknown expiry — still try access first; refresh only after 401 path below
        return false;
    }
    return Date.now() >= exp - REFRESH_SKEW_MS;
}

async function refreshDirectusAccess(refreshToken) {
    const base = directusBaseUrl();
    if (!base) {
        throw new AppError('Directus is not configured (DIRECTUS_URL)', 503);
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
        expires: data?.expires
    };
}

/**
 * @param {{ jti?: string, id?: number }} appUser - from authenticateToken (must include jti)
 * @returns {Promise<string>} Directus access token
 */
export async function getDirectusAccessTokenForAppUser(appUser) {
    const jti = appUser?.jti;
    const userId = appUser?.id;
    if (!jti || !userId) {
        throw new UnauthorizedError(
            'Session is incomplete; sign in again with Directus credentials',
            'DIRECTUS_SESSION_REQUIRED'
        );
    }

    if (!directusBaseUrl()) {
        throw new AppError('Directus is not configured (DIRECTUS_URL)', 503);
    }

    let tokens = getProviderTokens(jti);
    if (!tokens?.access_token && !tokens?.refresh_token) {
        throw new ForbiddenError(
            'Directus user session is missing. Sign out and sign in with your email and password '
            + '(not passkey alone) so Cases can access Directus as you. '
            + 'Requires AUTH_STORE_PROVIDER_TOKENS (enabled automatically when Cases is on).',
            'DIRECTUS_SESSION_REQUIRED'
        );
    }

    if (tokens.access_token && !accessLooksExpired(tokens)) {
        return tokens.access_token;
    }

    if (tokens.refresh_token) {
        const next = await refreshDirectusAccess(tokens.refresh_token);
        if (next?.accessToken) {
            storeProviderTokens(jti, userId, PROVIDER, next);
            return next.accessToken;
        }
    }

    // Access might still work if expiry clock was wrong — last try returned raw access
    if (tokens.access_token) {
        return tokens.access_token;
    }

    throw new ForbiddenError(
        'Directus session expired. Please sign in again with your Directus credentials.',
        'DIRECTUS_SESSION_EXPIRED'
    );
}

/**
 * Async middleware: after authenticateToken (+ optional requireDirectusLink).
 * Sets req.directusAccessToken.
 */
export async function requireDirectusUserToken(req, res, next) {
    try {
        const accessToken = await getDirectusAccessTokenForAppUser(req.user);
        req.directusAccessToken = accessToken;
        next();
    } catch (err) {
        next(err);
    }
}
