import crypto from 'crypto';
import config from '../config/index.js';

const ALGO = 'aes-256-gcm';

function deriveKey(secret) {
    return crypto.scryptSync(String(secret), 'gpu-credentials', 32);
}

/** Stable secrets used to encrypt/decrypt stored provider API keys (tried in order). */
function encryptionSecretCandidates() {
    const seen = new Set();
    const out = [];
    for (const raw of [
        process.env.GPU_CREDENTIALS_KEY,
        process.env.JWT_SECRET,
        config.jwt.secret
    ]) {
        const secret = String(raw || '').trim();
        if (!secret || seen.has(secret)) continue;
        seen.add(secret);
        out.push(secret);
    }
    return out;
}

function primaryEncryptionKey() {
    const secrets = encryptionSecretCandidates();
    if (!secrets.length) {
        throw new Error('No GPU_CREDENTIALS_KEY or JWT_SECRET available for credential encryption');
    }
    return deriveKey(secrets[0]);
}

function decryptWithKey(blob, key) {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
}

export function encryptCredentials(obj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, primaryEncryptionKey(), iv);
    const plaintext = JSON.stringify(obj || {});
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * @returns {object|null} Parsed credentials, {} if empty, null if blob exists but cannot be decrypted.
 */
export function decryptCredentials(blob) {
    if (!blob) return {};
    const keys = encryptionSecretCandidates().map(deriveKey);
    let lastError = null;
    for (const key of keys) {
        try {
            return decryptWithKey(blob, key);
        } catch (err) {
            lastError = err;
        }
    }
    console.error(
        'GPU credentials decrypt failed with all configured keys.',
        lastError?.message || lastError
    );
    return null;
}

export function maskSecret(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.length <= 8) return '********';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function warnIfGpuCredentialsKeyMissing() {
    if (process.env.GPU_CREDENTIALS_KEY?.trim()) return;
    console.warn(
        '⚠️  GPU_CREDENTIALS_KEY is not set — GPU API keys are encrypted with JWT_SECRET. '
        + 'Set a dedicated GPU_CREDENTIALS_KEY in .env so keys survive JWT rotation and env drift.'
    );
}
