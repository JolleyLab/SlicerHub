import crypto from 'crypto';
import { getSessionTtlMs } from './config.js';

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
        metadata
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

export function listActiveSessions(kind = null) {
    const active = [];
    for (const [key, entry] of sessions.entries()) {
        const [entryKind, sessionKey] = key.split(':', 2);
        if (kind && entryKind !== kind) continue;
        active.push({ kind: entryKind, sessionKey, ...entry });
    }
    return active;
}
