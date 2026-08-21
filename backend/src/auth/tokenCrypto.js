/**
 * Encrypt IdP tokens before writing SQLite (AES-256-GCM envelope payload).
 *
 * Key material:
 *   AUTH_TOKEN_KEY              — primary (required in production if storing tokens)
 *   AUTH_TOKEN_KEY_PREVIOUS     — optional rotation peer (decrypt only)
 *   GPU_CREDENTIALS_KEY / JWT   — last-resort decrypt/encrypt when AUTH_TOKEN_KEY unset (dev)
 *
 * Production path when AUTH_STORE_PROVIDER_TOKENS is on:
 *   prefer dedicated AUTH_TOKEN_KEY; later swap to KMS envelope without changing callers
 *   (keep encryptTokenPayload / decryptTokenPayload as the boundary).
 */

import crypto from 'crypto';
import config from '../config/index.js';

const ALGO = 'aes-256-gcm';
const SALT = 'auth-provider-tokens-v1';
const BLOB_PREFIX = 'enc:v1:';

function secretCandidates() {
    const seen = new Set();
    const out = [];
    for (const raw of [
        process.env.AUTH_TOKEN_KEY,
        process.env.AUTH_TOKEN_KEY_PREVIOUS,
        process.env.GPU_CREDENTIALS_KEY,
        process.env.JWT_SECRET,
        config.jwt?.secret
    ]) {
        const secret = String(raw || '').trim();
        if (!secret || seen.has(secret)) continue;
        seen.add(secret);
        out.push(secret);
    }
    return out;
}

function deriveKey(secret) {
    return crypto.scryptSync(String(secret), SALT, 32);
}

function primaryKey() {
    // Always encrypt with the primary AUTH_TOKEN_KEY when set (not PREVIOUS).
    const primary = String(process.env.AUTH_TOKEN_KEY || '').trim();
    if (primary) {
        return deriveKey(primary);
    }
    const secrets = secretCandidates();
    if (!secrets.length) {
        throw new Error('No AUTH_TOKEN_KEY, GPU_CREDENTIALS_KEY, or JWT_SECRET for token encryption');
    }
    return deriveKey(secrets[0]);
}

export function encryptTokenPayload(payload) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, primaryKey(), iv);
    const plaintext = JSON.stringify(payload || {});
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, tag, enc]).toString('base64');
    return `${BLOB_PREFIX}${blob}`;
}

function decryptWithKey(rawBase64, key) {
    const buf = Buffer.from(rawBase64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
}

/**
 * @returns {object|null} payload, or null if missing / unreadable
 */
export function decryptTokenPayload(stored) {
    if (!stored || typeof stored !== 'string') return null;

    if (!stored.startsWith(BLOB_PREFIX)) {
        // Refuse legacy plaintext rows — re-login if storage is re-enabled.
        return null;
    }

    const raw = stored.slice(BLOB_PREFIX.length);
    const keys = secretCandidates().map(deriveKey);
    for (const key of keys) {
        try {
            return decryptWithKey(raw, key);
        } catch {
            /* try next (supports AUTH_TOKEN_KEY_PREVIOUS rotation) */
        }
    }
    console.error('Auth provider token decrypt failed with all configured keys');
    return null;
}

export function warnIfAuthTokenKeyMissing() {
    if (config.auth?.storeProviderTokens !== true) {
        return;
    }
    if (process.env.AUTH_TOKEN_KEY?.trim()) return;
    console.warn(
        '⚠️  AUTH_STORE_PROVIDER_TOKENS=true but AUTH_TOKEN_KEY is unset. '
        + 'Set a dedicated AUTH_TOKEN_KEY (and AUTH_TOKEN_KEY_PREVIOUS during rotation).'
    );
}
