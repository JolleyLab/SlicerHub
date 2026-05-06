import { TooManyRequestsError } from '../utils/errors.js';

const counters = new Map();

function nowMs() {
    return Date.now();
}

function getClientIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }
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
    message = 'Too many requests',
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
