/**
 * WebAuthn credential persistence (public keys only — no private material).
 */

import db from '../../db/database.js';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export function listCredentialsForUser(userId) {
    return db.prepare(`
        SELECT id, user_id, credential_id, public_key, counter, transports_json,
               device_type, backed_up, friendly_name, created_at, last_used_at
        FROM auth_webauthn_credentials
        WHERE user_id = ?
        ORDER BY created_at DESC
    `).all(userId);
}

export function findCredentialById(credentialIdBase64Url) {
    return db.prepare(`
        SELECT id, user_id, credential_id, public_key, counter, transports_json,
               device_type, backed_up, friendly_name, created_at, last_used_at
        FROM auth_webauthn_credentials
        WHERE credential_id = ?
    `).get(String(credentialIdBase64Url)) || null;
}

export function countCredentialsForUser(userId) {
    const row = db.prepare(`
        SELECT COUNT(*) AS c FROM auth_webauthn_credentials WHERE user_id = ?
    `).get(userId);
    return Number(row?.c || 0);
}

/**
 * @param {{
 *   userId: number,
 *   credentialID: Uint8Array|string,
 *   credentialPublicKey: Uint8Array,
 *   counter: number,
 *   transports?: string[],
 *   deviceType?: string|null,
 *   backedUp?: boolean,
 *   friendlyName?: string|null
 * }} data
 */
export function insertCredential(data) {
    const credentialId = typeof data.credentialID === 'string'
        ? data.credentialID
        : isoBase64URL.fromBuffer(data.credentialID);
    const publicKey = isoBase64URL.fromBuffer(data.credentialPublicKey);
    const transports = Array.isArray(data.transports)
        ? JSON.stringify(data.transports)
        : null;

    const result = db.prepare(`
        INSERT INTO auth_webauthn_credentials
            (user_id, credential_id, public_key, counter, transports_json, device_type, backed_up, friendly_name, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
        data.userId,
        credentialId,
        publicKey,
        Number(data.counter) || 0,
        transports,
        data.deviceType || null,
        data.backedUp ? 1 : 0,
        data.friendlyName || null
    );

    return findCredentialById(credentialId) || {
        id: result.lastInsertRowid,
        user_id: data.userId,
        credential_id: credentialId
    };
}

export function updateCredentialCounter(credentialIdBase64Url, newCounter) {
    db.prepare(`
        UPDATE auth_webauthn_credentials
        SET counter = ?, last_used_at = CURRENT_TIMESTAMP
        WHERE credential_id = ?
    `).run(Number(newCounter) || 0, String(credentialIdBase64Url));
}

export function deleteCredential(userId, credentialRowId) {
    const result = db.prepare(`
        DELETE FROM auth_webauthn_credentials
        WHERE id = ? AND user_id = ?
    `).run(credentialRowId, userId);
    return result.changes > 0;
}

export function toPublicCredentialList(rows) {
    return (rows || []).map((row) => ({
        id: row.id,
        credentialId: row.credential_id,
        deviceType: row.device_type,
        backedUp: Boolean(row.backed_up),
        friendlyName: row.friendly_name,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
    }));
}

/** Shape expected by @simplewebauthn allowCredentials / verify */
export function toSimpleWebAuthnAuthenticator(row) {
    return {
        id: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: Number(row.counter) || 0,
        transports: row.transports_json ? JSON.parse(row.transports_json) : undefined
    };
}
