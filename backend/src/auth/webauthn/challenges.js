/**
 * Short-lived WebAuthn ceremony challenges (registration / authentication).
 * SQL today; same API can move to Redis later without changing routes.
 */

import db from '../../db/database.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function pruneWebauthnChallenges() {
    try {
        db.prepare(`DELETE FROM auth_webauthn_challenges WHERE expires_at < datetime('now')`).run();
    } catch {
        /* mid-migrate */
    }
}

/**
 * @param {{ challenge: string, type: 'registration'|'authentication', userId?: number|null, ttlMs?: number }} opts
 */
export function storeChallenge({ challenge, type, userId = null, ttlMs = DEFAULT_TTL_MS }) {
    pruneWebauthnChallenges();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    db.prepare(`
        INSERT OR REPLACE INTO auth_webauthn_challenges (challenge, type, user_id, expires_at)
        VALUES (?, ?, ?, ?)
    `).run(String(challenge), type, userId, expiresAt);
}

/**
 * Consume (delete) a valid challenge. Returns row or null.
 */
export function consumeChallenge(challenge, type) {
    pruneWebauthnChallenges();
    const row = db.prepare(`
        SELECT challenge, type, user_id, expires_at
        FROM auth_webauthn_challenges
        WHERE challenge = ? AND type = ? AND expires_at >= datetime('now')
    `).get(String(challenge), type);

    if (!row) return null;

    db.prepare('DELETE FROM auth_webauthn_challenges WHERE challenge = ?').run(String(challenge));
    return row;
}
