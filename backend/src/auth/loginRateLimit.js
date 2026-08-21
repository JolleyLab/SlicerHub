/**
 * Login throttling: IP attempt ceiling + failure budget per identity+IP.
 *
 * In-process today (single backend instance). Boundary for a shared store
 * later: keep the same assert / recordLoginFailure / recordLoginSuccess API.
 */

import crypto from 'crypto';
import config from '../config/index.js';
import { TooManyRequestsError } from '../utils/errors.js';
import { getRateLimitClientIp } from '../middleware/rateLimit.js';

const WINDOW_MS = 15 * 60 * 1000;

function limitMultiplier() {
    return config.auth?.devRelaxed ? 10 : 1;
}

/** All login POSTs from one IP (success or fail). */
function maxAttemptsPerIp() {
    return 30 * limitMultiplier();
}

/** Failed logins from one IP (any identity). */
function maxFailuresPerIp() {
    return 20 * limitMultiplier();
}

/** Failed logins for one identity from one IP. */
function maxFailuresPerIdentityIp() {
    return 8 * limitMultiplier();
}

const counters = new Map();

function nowMs() {
    return Date.now();
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

function getCounter(key) {
    const now = nowMs();
    const existing = counters.get(key);
    if (!existing || existing.resetAt <= now) {
        return null;
    }
    return existing;
}

function increment(key, windowMs = WINDOW_MS) {
    const now = nowMs();
    const existing = getCounter(key);
    if (!existing) {
        const entry = { count: 1, resetAt: now + windowMs };
        counters.set(key, entry);
        return entry;
    }
    existing.count += 1;
    counters.set(key, existing);
    return existing;
}

function isOver(key, max) {
    const existing = getCounter(key);
    return Boolean(existing && existing.count >= max);
}

function retryAfterFor(key) {
    const existing = getCounter(key);
    if (!existing) return 1;
    return Math.max(1, Math.ceil((existing.resetAt - nowMs()) / 1000));
}

function normalizeIdentity(req) {
    return String(
        req.body?.identity
        || req.body?.username
        || req.body?.email
        || ''
    ).trim().toLowerCase();
}

function identityFingerprint(identity) {
    if (!identity) return 'empty';
    return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function ipKey(ip) {
    return `login:attempt:ip:${ip}`;
}

function failIpKey(ip) {
    return `login:fail:ip:${ip}`;
}

function failIdentityIpKey(ip, identity) {
    return `login:fail:id:${ip}:${identityFingerprint(identity)}`;
}

const LIMIT_MESSAGE = 'Too many login attempts. Please wait and try again.';

/**
 * Middleware: reject if IP or identity+IP budgets are exhausted.
 * Does not consume failure budget (that happens only on failed auth).
 */
export function loginRateLimitMiddleware(req, res, next) {
    const ip = getRateLimitClientIp(req);
    const identity = normalizeIdentity(req);
    const maxAttempts = maxAttemptsPerIp();
    const maxFailIp = maxFailuresPerIp();
    const maxFailId = maxFailuresPerIdentityIp();

    if (isOver(ipKey(ip), maxAttempts)
        || isOver(failIpKey(ip), maxFailIp)
        || (identity && isOver(failIdentityIpKey(ip, identity), maxFailId))) {
        const retry = Math.max(
            retryAfterFor(ipKey(ip)),
            retryAfterFor(failIpKey(ip)),
            identity ? retryAfterFor(failIdentityIpKey(ip, identity)) : 1
        );
        res.set('Retry-After', String(retry));
        return next(new TooManyRequestsError(LIMIT_MESSAGE));
    }

    // Count this attempt toward the IP ceiling
    const attempts = increment(ipKey(ip));
    if (attempts.count > maxAttempts) {
        res.set('Retry-After', String(retryAfterFor(ipKey(ip))));
        return next(new TooManyRequestsError(LIMIT_MESSAGE));
    }

    return next();
}

/**
 * Call after failed password / provider verification (not validation errors).
 */
export function recordLoginFailure(req) {
    const ip = getRateLimitClientIp(req);
    const identity = normalizeIdentity(req);
    increment(failIpKey(ip));
    if (identity) {
        increment(failIdentityIpKey(ip, identity));
    }
}

/**
 * Clear failure counters for this identity+IP after a successful login.
 */
export function recordLoginSuccess(req) {
    const ip = getRateLimitClientIp(req);
    const identity = normalizeIdentity(req);
    if (identity) {
        counters.delete(failIdentityIpKey(ip, identity));
    }
}
