import { TooManyRequestsError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const counters = new Map();

function nowMs() {
    return Date.now();
}

/**
 * Client IP for rate limits and audit. Uses Express's req.ip, which (with
 * `trust proxy` = 1 in server.js) is the address nginx puts in X-Forwarded-For.
 * nginx overwrites that header with the real client address (resolved from
 * CF-Connecting-IP behind the Cloudflare tunnel), so the raw header — whose first
 * entry the client controls — must not be read here.
 */
function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown-ip';
}

function pruneExpired() {
    const now = nowMs();
    for (const [key, value] of counters.entries()) {
        if (!value || value.resetAt <= now) {
            counters.delete(key);
        }
    }
}

setInterval(pruneExpired, 60 * 1000);

export function createRateLimiter({
    windowMs,
    max,
    message = msg('rate_limit.generic'),
    getKey
}) {
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
        throw new Error('createRateLimiter requires a positive integer windowMs');
    }
    if (!Number.isInteger(max) || max <= 0) {
        throw new Error('createRateLimiter requires a positive integer max');
    }

    return function rateLimitMiddleware(req, res, next) {
        const derivedKey = typeof getKey === 'function' ? getKey(req) : getClientIp(req);
        const key = String(derivedKey || 'default');
        const now = nowMs();
        const existing = counters.get(key);

        if (!existing || existing.resetAt <= now) {
            counters.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        existing.count += 1;
        counters.set(key, existing);

        if (existing.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
            res.set('Retry-After', String(retryAfterSeconds));
            return next(new TooManyRequestsError(message));
        }

        return next();
    };
}

export function getRateLimitClientIp(req) {
    return getClientIp(req);
}
