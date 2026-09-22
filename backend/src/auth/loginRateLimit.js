/**
 * Login throttling:
 *   1) Per-identity cool-down after consecutive bad passwords (account soft-lock)
 *   2) IP attempt ceiling + failure budget (spray / botnet)
 *
 * Email unlock / secondary verification can replace (1) later; for now the
 * lock expires after AUTH_LOGIN_LOCKOUT_MINUTES (default 30).
 *
 * In-process today (single backend instance). Keep the same assert /
 * recordLoginFailure / recordLoginSuccess API when moving to a shared store.
 */

import crypto from 'crypto';
import config from '../config/index.js';
import { TooManyRequestsError } from '../utils/errors.js';
import { getRateLimitClientIp } from '../middleware/rateLimit.js';

const IP_WINDOW_MS = 15 * 60 * 1000;

function isDevSoftLimits() {
    return Boolean(config.isDevelopment || config.auth?.devRelaxed);
}

function limitMultiplier() {
    return isDevSoftLimits() ? 10 : 1;
}

/** All login POSTs from one IP (success or fail). */
function maxAttemptsPerIp() {
    return 30 * limitMultiplier();
}

/** Failed logins from one IP (any identity). */
function maxFailuresPerIp() {
    return 20 * limitMultiplier();
}

/** Consecutive wrong-password attempts before account cool-down. */
function maxFailuresBeforeLock() {
    const raw = Number(config.auth?.loginMaxFailures);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

/** Cool-down length after the failure threshold is hit. */
function lockoutMs() {
    const envMins = process.env.AUTH_LOGIN_LOCKOUT_MINUTES;
    if (envMins != null && String(envMins).trim() !== '') {
        const mins = Number(envMins);
        const resolved = Number.isFinite(mins) && mins > 0 ? mins : 30;
        return resolved * 60 * 1000;
    }
    // Local/dev: keep the 5-failure threshold, shorten the wait so testing isn't blocked.
    if (isDevSoftLimits()) {
        return 60 * 1000;
    }
    const mins = Number(config.auth?.loginLockoutMinutes);
    const resolved = Number.isFinite(mins) && mins > 0 ? mins : 30;
    return resolved * 60 * 1000;
}

const counters = new Map();
/** @type {Map<string, { failures: number, lockedUntil: number|null }>} */
const accountLocks = new Map();

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
    for (const [key, value] of accountLocks.entries()) {
        if (!value) {
            accountLocks.delete(key);
            continue;
        }
        if (value.lockedUntil && value.lockedUntil <= now && value.failures === 0) {
            accountLocks.delete(key);
        } else if (value.lockedUntil && value.lockedUntil <= now) {
            // Lock expired — clear so the next attempt starts a fresh budget.
            accountLocks.delete(key);
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

function increment(key, windowMs = IP_WINDOW_MS) {
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

function accountKey(identity) {
    return identityFingerprint(identity);
}

function getAccountState(identity) {
    if (!identity) return null;
    const key = accountKey(identity);
    const state = accountLocks.get(key);
    if (!state) return null;
    if (state.lockedUntil && state.lockedUntil <= nowMs()) {
        accountLocks.delete(key);
        return null;
    }
    return state;
}

function retryAfterForAccount(state) {
    if (!state?.lockedUntil) return 1;
    return Math.max(1, Math.ceil((state.lockedUntil - nowMs()) / 1000));
}

function cooldownMessage(retryAfterSec) {
    const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
    if (minutes === 1) {
        return 'Too many failed sign-in attempts. Try again in 1 minute.';
    }
    return `Too many failed sign-in attempts. Try again in ${minutes} minutes.`;
}

const IP_LIMIT_MESSAGE = 'Too many login attempts. Please wait and try again.';

/**
 * Middleware: reject if account cool-down or IP budgets are exhausted.
 * Does not consume failure budget (that happens only on failed auth).
 */
export function loginRateLimitMiddleware(req, res, next) {
    const ip = getRateLimitClientIp(req);
    const identity = normalizeIdentity(req);

    if (identity) {
        const account = getAccountState(identity);
        if (account?.lockedUntil && account.lockedUntil > nowMs()) {
            const retry = retryAfterForAccount(account);
            res.set('Retry-After', String(retry));
            return next(new TooManyRequestsError(cooldownMessage(retry), 'ACCOUNT_COOLDOWN'));
        }
    }

    const maxAttempts = maxAttemptsPerIp();
    const maxFailIp = maxFailuresPerIp();

    if (isOver(ipKey(ip), maxAttempts) || isOver(failIpKey(ip), maxFailIp)) {
        const retry = Math.max(retryAfterFor(ipKey(ip)), retryAfterFor(failIpKey(ip)));
        res.set('Retry-After', String(retry));
        return next(new TooManyRequestsError(IP_LIMIT_MESSAGE));
    }

    const attempts = increment(ipKey(ip));
    if (attempts.count > maxAttempts) {
        res.set('Retry-After', String(retryAfterFor(ipKey(ip))));
        return next(new TooManyRequestsError(IP_LIMIT_MESSAGE));
    }

    return next();
}

/**
 * Call after failed password / provider verification (not validation errors).
 * @returns {{ locked: boolean, justLocked?: boolean, retryAfterSec?: number }}
 */
export function recordLoginFailure(req) {
    const ip = getRateLimitClientIp(req);
    const identity = normalizeIdentity(req);
    increment(failIpKey(ip));

    if (!identity) {
        return { locked: false };
    }

    const key = accountKey(identity);
    const existing = getAccountState(identity);
    if (existing?.lockedUntil && existing.lockedUntil > nowMs()) {
        return {
            locked: true,
            justLocked: false,
            retryAfterSec: retryAfterForAccount(existing)
        };
    }

    const failures = (existing?.failures || 0) + 1;
    const max = maxFailuresBeforeLock();

    if (failures >= max) {
        const lockedUntil = nowMs() + lockoutMs();
        accountLocks.set(key, { failures: 0, lockedUntil });
        const retryAfterSec = Math.max(1, Math.ceil((lockedUntil - nowMs()) / 1000));
        return { locked: true, justLocked: true, retryAfterSec };
    }

    accountLocks.set(key, { failures, lockedUntil: null });
    return { locked: false };
}

/**
 * Clear failure / cool-down state for this identity after a successful login.
 */
export function recordLoginSuccess(req) {
    const identity = normalizeIdentity(req);
    if (identity) {
        accountLocks.delete(accountKey(identity));
    }
}

/**
 * Apply a failed-login outcome: may set Retry-After and throw 429 cool-down.
 * @returns {boolean} true if a cool-down was applied (caller should not rethrow 401)
 */
export function throwIfAccountCooldown(req, res, failureOutcome) {
    if (!failureOutcome?.locked) return false;
    const retry = failureOutcome.retryAfterSec || 1;
    res.set('Retry-After', String(retry));
    throw new TooManyRequestsError(cooldownMessage(retry), 'ACCOUNT_COOLDOWN');
}
