/**
 * Auth audit trail (login outcomes, registration). Identity is hashed, never raw password.
 * Retention: prune events older than AUTH_AUDIT_RETENTION_DAYS (default 90).
 */

import crypto from 'crypto';
import db from '../db/database.js';
import { getRateLimitClientIp } from '../middleware/rateLimit.js';

const DEFAULT_RETENTION_DAYS = 90;

function retentionDays() {
    const n = parseInt(process.env.AUTH_AUDIT_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

export function hashIdentity(identity) {
    const norm = String(identity || '').trim().toLowerCase();
    if (!norm) return null;
    return crypto.createHash('sha256').update(norm).digest('hex');
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
 * @param {{
 *   event: string,
 *   provider?: string|null,
 *   userId?: number|null,
 *   identity?: string|null,
 *   detail?: string|null,
 *   req?: import('express').Request
 * }} entry
 */
export function recordAuthEvent(entry) {
    try {
        maybePrune();
        const req = entry.req;
        const ip = req ? getRateLimitClientIp(req) : null;
        const ua = req?.get?.('user-agent') || null;
        db.prepare(`
            INSERT INTO auth_audit_events
                (event, provider, user_id, identity_hash, ip, user_agent, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            String(entry.event || 'unknown').slice(0, 64),
            entry.provider != null ? String(entry.provider).slice(0, 32) : null,
            entry.userId ?? null,
            entry.identity != null ? hashIdentity(entry.identity) : null,
            ip != null ? String(ip).slice(0, 64) : null,
            ua != null ? String(ua).slice(0, 512) : null,
            entry.detail != null ? String(entry.detail).slice(0, 128) : null
        );
    } catch (err) {
        console.warn('auth audit write failed:', err.message);
    }
}
