/**
 * Browser-held Directus refresh for Cases call-as-user.
 * Survives product-session jti changes (e.g. idle refresh) without a SQLite mirror.
 * Encrypted httpOnly cookie — never readable from JS.
 */

import { encryptTokenPayload, decryptTokenPayload } from './tokenCrypto.js';

export const DIRECTUS_LINK_COOKIE = 'dx_link';

/** Align with product session cookie (7d); refreshed on each successful Directus attach. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cookieSecure() {
    return process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
}

function cookieOpts(maxAge = MAX_AGE_MS) {
    return {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'strict',
        path: '/',
        maxAge
    };
}

/**
 * @param {import('express').Response} res
 * @param {{ userId: number, refreshToken?: string|null, accessToken?: string|null, expiresAt?: string|null, expires?: number|null }} tokens
 */
export function setDirectusLinkCookie(res, tokens = {}) {
    if (!res || !tokens?.userId) return;
    const refresh = tokens.refreshToken || tokens.refresh_token || null;
    const access = tokens.accessToken || tokens.access_token || null;
    if (!refresh && !access) return;

    let expiresAt = tokens.expiresAt || tokens.expires_at || null;
    if (!expiresAt && tokens.expires != null) {
        const n = Number(tokens.expires);
        if (Number.isFinite(n) && n > 0) {
            const ms = n > 10 * 24 * 3600 ? n : n * 1000;
            expiresAt = new Date(Date.now() + ms).toISOString();
        }
    }

    const blob = encryptTokenPayload({
        userId: Number(tokens.userId),
        refreshToken: refresh,
        accessToken: access,
        expiresAt
    });

    res.cookie(DIRECTUS_LINK_COOKIE, blob, cookieOpts());
}

/**
 * @returns {{ userId: number, refreshToken: string|null, accessToken: string|null, expiresAt: string|null } | null}
 */
export function getDirectusLinkCookie(req) {
    const raw = req?.cookies?.[DIRECTUS_LINK_COOKIE];
    if (!raw || typeof raw !== 'string') return null;

    const payload = decryptTokenPayload(raw);
    if (!payload) return null;

    const userId = Number(payload.userId);
    if (!Number.isInteger(userId) || userId < 1) return null;
    if (!payload.refreshToken && !payload.accessToken) return null;

    return {
        userId,
        refreshToken: payload.refreshToken || null,
        accessToken: payload.accessToken || null,
        expiresAt: payload.expiresAt || null
    };
}

export function clearDirectusLinkCookie(res) {
    if (!res) return;
    res.clearCookie(DIRECTUS_LINK_COOKIE, {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'strict',
        path: '/'
    });
}
