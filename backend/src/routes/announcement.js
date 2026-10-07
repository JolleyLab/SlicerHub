import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { directusFetch } from '../services/directus.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = { announcement: null, fetchedAt: 0 };

async function fetchActiveAnnouncement() {
    const now = Date.now();
    if (now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.announcement;
    }

    let announcement = null;
    try {
        const payload = await directusFetch('/items/site_announcement');
        const row = payload?.data;
        if (row?.enabled && row?.message) {
            const expires = row.expires_at ? new Date(row.expires_at).getTime() : null;
            if (!expires || expires > now) {
                announcement = {
                    message:  String(row.message),
                    severity: ['info', 'warning', 'error'].includes(row.severity) ? row.severity : 'info'
                };
            }
        }
    } catch (err) {
        // Directus unavailable — return whatever is cached (or null).
        console.warn('[announcement] Could not fetch from Directus:', err?.message);
        return _cache.announcement;
    }

    _cache = { announcement, fetchedAt: now };
    return announcement;
}

export default function announcementRoutes(app) {
    app.get('/api/announcement', authenticateToken, asyncHandler(async (_req, res) => {
        const announcement = await fetchActiveAnnouncement();
        res.json({ announcement });
    }));
}
