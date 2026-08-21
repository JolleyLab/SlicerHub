/**
 * CSRF-style browser checks for cookie-authenticated mutations.
 * Allows browsers with Origin/Referer on the CORS allowlist; permits
 * non-browser clients with no Origin (scripts/tests). Rejects disallowed Origin.
 */

import config from '../config/index.js';
import { ForbiddenError } from '../utils/errors.js';

function parseOrigin(value) {
    if (!value || typeof value !== 'string') return null;
    try {
        const u = new URL(value);
        return `${u.protocol}//${u.host}`;
    } catch {
        return null;
    }
}

function allowedOrigins() {
    const list = config.server?.corsOrigins || [];
    return new Set(list.map((o) => String(o).replace(/\/+$/, '').toLowerCase()));
}

/**
 * Middleware for POST/PUT/PATCH/DELETE under /api/auth/* that can set or use cookies.
 */
export function requireAllowedWebOrigin(req, res, next) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }

    const originHeader = req.get('origin');
    const refererHeader = req.get('referer');
    const origin = parseOrigin(originHeader) || parseOrigin(refererHeader);

    if (!origin) {
        // curl, load tests, service-to-service — no browser Origin
        return next();
    }

    const allowed = allowedOrigins();
    if (allowed.has(origin.toLowerCase())) {
        return next();
    }

    return next(new ForbiddenError('Request origin is not allowed'));
}
