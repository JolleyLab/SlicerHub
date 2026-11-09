/**
 * App secrets live in the repo's .env (git-ignored). bootstrap.mjs calls ensureSecrets()
 * before the first `docker compose up`, so a fresh install never runs on a known default.
 *
 * Database passwords only take effect when the database volume is first created. If the
 * volume already exists and the password isn't in .env, the database was set up with the
 * old compose default, so that default is written instead of a new random value.
 */

import crypto from 'crypto';
import fs from 'fs';
import { readEnvFile, upsertEnvVar } from './env.mjs';

const hex = (bytes) => () => crypto.randomBytes(bytes).toString('hex');

export const SECRETS = [
    // Hex keeps the DB passwords safe inside PAYLOAD_DATABASE_URI.
    { key: 'KEYCLOAK_DB_PASSWORD', generate: hex(24), volume: 'keycloak-db-data', legacyDefault: 'keycloak-dev-password' },
    { key: 'PAYLOAD_DB_PASSWORD', generate: hex(24), volume: 'payload-db-data', legacyDefault: 'payload-dev-password' },
    // Keycloak creates its master admin from this on the first start only.
    { key: 'KEYCLOAK_ADMIN_PASSWORD', generate: hex(16), volume: 'keycloak-db-data', legacyDefault: 'admin' },
    { key: 'PAYLOAD_SECRET', generate: hex(64) },
    // Encrypts the ID token on each session row. Older rows still decrypt with the
    // fallback keys (tokenCrypto.js), so adding one to an existing install is safe.
    { key: 'AUTH_TOKEN_KEY', generate: hex(32) },
];

/**
 * Write any missing secret to `envFile`. `volumeExists(name)` says whether a compose
 * volume already holds data. Returns [{ key, how: 'generated' | 'legacy-default' }].
 */
export function ensureSecrets(envFile, volumeExists) {
    const current = readEnvFile(envFile);
    const written = [];
    for (const s of SECRETS) {
        if ((current[s.key] || '').trim()) continue;
        const keepLegacy = s.volume && volumeExists(s.volume);
        upsertEnvVar(envFile, s.key, keepLegacy ? s.legacyDefault : s.generate());
        written.push({ key: s.key, how: keepLegacy ? 'legacy-default' : 'generated' });
    }
    if (process.platform !== 'win32') fs.chmodSync(envFile, 0o600); // owner-only
    return written;
}

/** Secrets still set to a public default (worth changing on a server others can reach). */
export function secretsOnKnownDefaults(envFile) {
    const current = readEnvFile(envFile);
    return SECRETS.filter((s) => s.legacyDefault && current[s.key] === s.legacyDefault).map((s) => s.key);
}
