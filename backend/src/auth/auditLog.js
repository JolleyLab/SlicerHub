/**
 * Auth audit trail (login outcomes, logout, password changes).
 *
 * Privacy: records what happened, to which account (user id) and when — nothing else.
 * No IP address, browser/user agent or login identity is stored: the per-IP rate
 * limits keep IPs in memory only (auth/loginRateLimit.js), and an unsalted hash of an
 * email is reversible by anyone holding a list of candidate emails.
 * Retention: prune events older than AUTH_AUDIT_RETENTION_DAYS (default 30).
 */

import db from '../db/database.js';

const DEFAULT_RETENTION_DAYS = 30;

function retentionDays() {
    const n = parseInt(process.env.AUTH_AUDIT_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

let lastPruneAt = 0;

function maybePrune() {
    const now = Date.now();
    // At most once per hour per process
    if (now - lastPruneAt < 60 * 60 * 1000) return;
    lastPruneAt = now;
    const days = retentionDays();
    try {
        db.prepare(`
            DELETE FROM auth_audit_events
            WHERE created_at < datetime('now', ?)
        `).run(`-${days} days`);
    } catch {
        /* table may not exist yet mid-migrate */
    }
}

/**
 * Callers may still pass `identity` and `req`; they are deliberately not stored.
 *
 * @param {{
 *   event: string,
 *   provider?: string|null,
 *   userId?: number|string|null,
 *   detail?: string|null
 * }} entry
 */
export function recordAuthEvent(entry) {
    try {
        maybePrune();
        db.prepare(`
            INSERT INTO auth_audit_events (event, provider, user_id, detail)
            VALUES (?, ?, ?, ?)
        `).run(
            String(entry.event || 'unknown').slice(0, 64),
            entry.provider != null ? String(entry.provider).slice(0, 32) : null,
            entry.userId ?? null,
            entry.detail != null ? String(entry.detail).slice(0, 128) : null
        );
    } catch (err) {
        console.warn('auth audit write failed:', err.message);
    }
}
