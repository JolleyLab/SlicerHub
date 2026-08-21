/**
 * "Remember this device" for IdP MFA:
 * after a full password (+ OTP) login we store an encrypted refresh token bound
 * to a httpOnly device cookie. On a later password login that hits OTP, the BFF
 * can refresh the IdP session instead of prompting for a new code.
 *
 * Not a full MFA bypass — first visit still needs OTP when the IdP requires it.
 */

import crypto from 'crypto';
import db from '../db/database.js';
import config from '../config/index.js';
import { encryptTokenPayload, decryptTokenPayload } from './tokenCrypto.js';
import { hashIdentity } from './auditLog.js';

export const DEVICE_COOKIE = 'auth_device';

function cookieSecure() {
    return process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
}

export function trustedDeviceTtlDays() {
    if (config.auth?.devRelaxed) {
        const n = parseInt(process.env.AUTH_DEVICE_TRUST_DAYS || '90', 10);
        return Number.isFinite(n) && n > 0 ? n : 90;
    }
    const n = parseInt(process.env.AUTH_DEVICE_TRUST_DAYS || '30', 10);
    return Number.isFinite(n) && n > 0 ? n : 30;
}

function tokenHash(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function pruneExpired() {
    try {
        db.prepare(`DELETE FROM auth_trusted_devices WHERE expires_at < datetime('now')`).run();
    } catch {
        /* table may be mid-migrate */
    }
}

/**
 * Look up stored refresh for this browser device + identity.
 * @returns {{ refreshToken: string, id: number } | null}
 */
export function getTrustedDeviceRefresh(provider, identity, rawDeviceToken) {
    if (!rawDeviceToken || !identity) return null;
    pruneExpired();

    const row = db.prepare(`
        SELECT id, refresh_token_enc, expires_at
        FROM auth_trusted_devices
        WHERE provider = ?
          AND identity_hash = ?
          AND device_token_hash = ?
          AND expires_at >= datetime('now')
    `).get(provider, hashIdentity(identity), tokenHash(rawDeviceToken));

    if (!row) return null;

    const payload = decryptTokenPayload(row.refresh_token_enc);
    const refreshToken = payload?.refreshToken || null;
    if (!refreshToken) return null;

    return { id: row.id, refreshToken };
}

/**
 * Create or rotate device trust after successful IdP login with a refresh token.
 * @returns {string} raw device token to set as cookie (existing or new)
 */
export function upsertTrustedDevice({
    provider,
    identity,
    userId,
    refreshToken,
    existingRawToken = null
}) {
    if (!refreshToken || !identity) return existingRawToken;

    pruneExpired();
    const identityHash = hashIdentity(identity);
    const enc = encryptTokenPayload({ refreshToken: String(refreshToken) });
    const days = trustedDeviceTtlDays();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    if (existingRawToken) {
        const hash = tokenHash(existingRawToken);
        const existing = db.prepare(`
            SELECT id FROM auth_trusted_devices
            WHERE provider = ? AND identity_hash = ? AND device_token_hash = ?
        `).get(provider, identityHash, hash);

        if (existing) {
            db.prepare(`
                UPDATE auth_trusted_devices
                SET refresh_token_enc = ?,
                    user_id = ?,
                    expires_at = ?,
                    last_used_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(enc, userId ?? null, expiresAt, existing.id);
            return existingRawToken;
        }
    }

    const raw = crypto.randomBytes(32).toString('base64url');
    db.prepare(`
        INSERT INTO auth_trusted_devices
            (provider, identity_hash, user_id, device_token_hash, refresh_token_enc, expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(provider, identityHash, userId ?? null, tokenHash(raw), enc, expiresAt);

    return raw;
}

export function setDeviceCookie(res, rawToken) {
    if (!rawToken) return;
    const days = trustedDeviceTtlDays();
    res.cookie(DEVICE_COOKIE, rawToken, {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'strict',
        path: '/',
        maxAge: days * 24 * 60 * 60 * 1000
    });
}

export function clearDeviceCookie(res) {
    res.clearCookie(DEVICE_COOKIE, {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: 'strict',
        path: '/'
    });
}

export function revokeTrustedDevice(rawDeviceToken) {
    if (!rawDeviceToken) return;
    db.prepare('DELETE FROM auth_trusted_devices WHERE device_token_hash = ?')
        .run(tokenHash(rawDeviceToken));
}

export function revokeTrustedDevicesForUser(userId) {
    if (userId == null) return;
    db.prepare('DELETE FROM auth_trusted_devices WHERE user_id = ?').run(userId);
}

export function touchTrustedDevice(id) {
    if (id == null) return;
    db.prepare(`
        UPDATE auth_trusted_devices SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
}
