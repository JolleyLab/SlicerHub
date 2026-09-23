/**
 * Maps external identity-provider subjects → local product users,
 * and stores provider tokens (encrypted) keyed by app session jti.
 */

import db, { flushDatabase } from '../db/database.js';
import { encryptTokenPayload, decryptTokenPayload } from './tokenCrypto.js';

export function findLink(provider, externalId) {
    return db.prepare(`
        SELECT id, user_id, provider, external_id, created_at
        FROM auth_identity_links
        WHERE provider = ? AND external_id = ?
    `).get(provider, String(externalId));
}

export function findLinksForUser(userId) {
    return db.prepare(`
        SELECT id, user_id, provider, external_id, created_at
        FROM auth_identity_links
        WHERE user_id = ?
    `).all(userId);
}

/** Directus subject for a product user (1:1 content identity). */
export function findDirectusLinkForUser(userId) {
    return db.prepare(`
        SELECT id, user_id, provider, external_id, created_at
        FROM auth_identity_links
        WHERE user_id = ? AND provider = 'directus'
        LIMIT 1
    `).get(userId) || null;
}

/** App user id for a Directus subject, if linked. */
export function findAppUserIdByDirectusExternalId(externalId) {
    const ext = String(externalId || '').trim();
    if (!ext) return null;
    const row = db.prepare(`
        SELECT user_id
        FROM auth_identity_links
        WHERE provider = 'directus' AND external_id = ?
        LIMIT 1
    `).get(ext);
    return row?.user_id != null ? Number(row.user_id) : null;
}

export function hasDirectusIdentity(userId) {
    return Boolean(findDirectusLinkForUser(userId));
}

export function linkIdentity(userId, provider, externalId) {
    const existing = findLink(provider, externalId);
    if (existing) {
        if (existing.user_id !== userId) {
            throw new Error(`Identity already linked to another user (${provider}:${externalId})`);
        }
        return existing;
    }

    const result = db.prepare(`
        INSERT INTO auth_identity_links (user_id, provider, external_id)
        VALUES (?, ?, ?)
    `).run(userId, provider, String(externalId));

    // sql.js is in-process — force disk write so a restart sees the link.
    // (A separate migrate process writing the file can still be clobbered by a
    // long-running backend that keeps an older in-memory copy.)
    try {
        flushDatabase();
    } catch {
        /* best effort */
    }

    return {
        id: result.lastInsertRowid,
        user_id: userId,
        provider,
        external_id: String(externalId)
    };
}

/**
 * Persist IdP tokens encrypted at rest, keyed by app session jti.
 * Columns access_token / refresh_token: access_token holds enc blob; refresh cleared.
 * Durable Directus refresh across session re-issues lives in an httpOnly cookie
 * (see directusLinkCookie.js) — not a second SQLite table.
 */
export function storeProviderTokens(tokenJti, userId, provider, tokens = {}) {
    const access = tokens.accessToken || tokens.access_token || null;
    const refresh = tokens.refreshToken || tokens.refresh_token || null;
    let expiresAt = null;
    if (tokens.expiresAt) {
        expiresAt = tokens.expiresAt;
    } else if (tokens.expires != null) {
        const n = Number(tokens.expires);
        if (Number.isFinite(n) && n > 0) {
            // Directus usually returns TTL in ms; small values may be seconds.
            const ms = n > 10 * 24 * 3600 ? n : n * 1000;
            expiresAt = new Date(Date.now() + ms).toISOString();
        }
    }

    if (!access && !refresh) {
        return;
    }

    const encrypted = encryptTokenPayload({
        accessToken: access,
        refreshToken: refresh,
        expiresAt
    });

    db.prepare(`
        INSERT INTO auth_provider_tokens (token_jti, user_id, provider, access_token, refresh_token, expires_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(token_jti) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = NULL,
            expires_at = excluded.expires_at
    `).run(tokenJti, userId, provider, encrypted, expiresAt);
    try {
        flushDatabase();
    } catch {
        /* best effort */
    }
}

/**
 * @returns {{ token_jti, user_id, provider, access_token, refresh_token, expires_at, created_at } | null}
 * access_token / refresh_token are plaintext after decrypt (or null if unreadable).
 */
export function getProviderTokens(tokenJti) {
    const row = db.prepare(`
        SELECT token_jti, user_id, provider, access_token, refresh_token, expires_at, created_at
        FROM auth_provider_tokens
        WHERE token_jti = ?
    `).get(tokenJti);

    if (!row) return null;

    // New rows: single encrypted payload in access_token
    const payload = decryptTokenPayload(row.access_token);
    if (payload) {
        return {
            ...row,
            access_token: payload.accessToken || null,
            refresh_token: payload.refreshToken || null,
            expires_at: payload.expiresAt || row.expires_at
        };
    }

    // No usable secret material (legacy plaintext deliberately discarded)
    return {
        ...row,
        access_token: null,
        refresh_token: null
    };
}

export function clearProviderTokens(tokenJti) {
    if (!tokenJti) return;
    db.prepare('DELETE FROM auth_provider_tokens WHERE token_jti = ?').run(tokenJti);
}

export function clearProviderTokensForUser(userId) {
    db.prepare('DELETE FROM auth_provider_tokens WHERE user_id = ?').run(userId);
}
