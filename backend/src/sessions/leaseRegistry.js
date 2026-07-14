import crypto from 'crypto';
import { getSessionTtlMs, getWarmIdleTtlMs } from './config.js';

/** @type {Map<string, { sessionToken: string, lastHeartbeatAt: number, leaseExpiresAt: number, startedAt: number, metadata: Record<string, unknown> }>} */
const sessions = new Map();

function makeKey(kind, sessionKey) {
    return `${kind}:${String(sessionKey)}`;
}

export function createSessionToken() {
    return crypto.randomBytes(16).toString('hex');
}

export function beginSession(kind, sessionKey, {
    sessionToken = createSessionToken(),
    metadata = {}
} = {}) {
    const now = Date.now();
    const ttlMs = getSessionTtlMs(kind);
    const entry = {
        sessionToken,
        lastHeartbeatAt: now,
        leaseExpiresAt: now + ttlMs,
        startedAt: now,
        metadata: {
            ...metadata,
            parked: false,
            viewerAttached: true
        }
    };
    sessions.set(makeKey(kind, sessionKey), entry);
    return entry;
}

export function touchSession(kind, sessionKey, sessionToken) {
    const entry = sessions.get(makeKey(kind, sessionKey));
    if (!entry || entry.sessionToken !== sessionToken) {
        return null;
    }
    const now = Date.now();
    entry.lastHeartbeatAt = now;
    entry.leaseExpiresAt = now + getSessionTtlMs(kind);
    entry.metadata = {
        ...entry.metadata,
        parked: false,
        viewerAttached: true
    };
    return entry;
}

/**
 * Soft-release: keep runtime, drop attached-UI requirement, park until warm-idle TTL.
 * Watchdog hard-stops when the parked lease expires.
 */
export function parkSession(kind, sessionKey, sessionToken, { idleTtlMs = null } = {}) {
    const entry = sessions.get(makeKey(kind, sessionKey));
    if (!entry || entry.sessionToken !== sessionToken) {
        return null;
    }
    const now = Date.now();
    const parkMs = idleTtlMs != null ? idleTtlMs : getWarmIdleTtlMs(kind);
    entry.lastHeartbeatAt = now;
    entry.leaseExpiresAt = now + parkMs;
    entry.metadata = {
        ...entry.metadata,
        parked: true,
        viewerAttached: false,
        parkedAt: now
    };
    return entry;
}

export function endSession(kind, sessionKey, sessionToken) {
    const key = makeKey(kind, sessionKey);
    const entry = sessions.get(key);
    if (!entry || entry.sessionToken !== sessionToken) {
        return false;
    }
    sessions.delete(key);
    return true;
}

export function clearSession(kind, sessionKey) {
    return sessions.delete(makeKey(kind, sessionKey));
}

export function getSession(kind, sessionKey) {
    return sessions.get(makeKey(kind, sessionKey)) || null;
}

export function patchSessionMetadata(kind, sessionKey, patch = {}) {
    const entry = sessions.get(makeKey(kind, sessionKey));
    if (!entry) return null;
    entry.metadata = {
        ...entry.metadata,
        ...patch
    };
    return entry;
}

export function clearSessions(kind = null) {
    if (!kind) {
        sessions.clear();
        return;
    }
    for (const key of [...sessions.keys()]) {
        if (key.startsWith(`${kind}:`)) {
            sessions.delete(key);
        }
    }
}

export function listExpiredSessions(kind = null, now = Date.now()) {
    const expired = [];
    for (const [key, entry] of sessions.entries()) {
        const [entryKind, sessionKey] = key.split(':', 2);
        if (kind && entryKind !== kind) continue;
        if (entry.leaseExpiresAt <= now) {
            expired.push({
                kind: entryKind,
                sessionKey,
                sessionToken: entry.sessionToken,
                metadata: entry.metadata
            });
        }
    }
    return expired;
}
