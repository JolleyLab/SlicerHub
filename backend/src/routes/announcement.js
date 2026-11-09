import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';

// Short, so a new notice (or switching one off) reaches everyone within a minute.
const CACHE_TTL_MS = 60 * 1000;
const SEVERITIES = ['info', 'warning', 'error'];
let cache = { row: null, fetchedAt: 0 };

/**
 * The banner to show now, from the `site-announcement` global (Payload admin), or null.
 * Shown while enabled and inside its optional window (starts_at … expires_at).
 */
export function activeAnnouncement(row, now = Date.now()) {
    if (!row?.enabled || !String(row.message || '').trim()) return null;
    const startsAt = row.starts_at ? Date.parse(row.starts_at) : null;
    const expiresAt = row.expires_at ? Date.parse(row.expires_at) : null;
    if (startsAt && startsAt > now) return null;
    if (expiresAt && expiresAt <= now) return null;
    return {
        message: String(row.message).trim(),
        severity: SEVERITIES.includes(row.severity) ? row.severity : 'info',
    };
}

async function readAnnouncement() {
    const now = Date.now();
    if (now - cache.fetchedAt < CACHE_TTL_MS) return cache.row;
    const payload = getPayloadClient();
    if (!payload) return null;
    try {
        const row = await payload.findGlobal({ slug: 'site-announcement', depth: 0 });
        cache = { row, fetchedAt: now };
    } catch (err) {
        // Keep showing whatever was last read.
        console.warn('[announcement] Could not read the site announcement:', err?.message);
    }
    return cache.row;
}

export default function announcementRoutes(app) {
    app.get('/api/announcement', authenticateToken, asyncHandler(async (_req, res) => {
        // The window is checked on every request, so a cached notice still starts and
        // ends on time.
        res.json({ announcement: activeAnnouncement(await readAnnouncement()) });
    }));
}
