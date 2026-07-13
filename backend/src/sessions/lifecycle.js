import {
    beginSession,
    clearSession,
    createSessionToken,
    endSession,
    getSession,
    touchSession
} from './leaseRegistry.js';
import { getSessionTtlSeconds } from './config.js';
import { getSessionProvider } from './watchdog.js';

export { createSessionToken, getSessionTtlSeconds };

export function registerViewerSession(kind, sessionKey, options = {}) {
    return beginSession(kind, sessionKey, options);
}

export function touchViewerSession(kind, sessionKey, sessionToken) {
    return touchSession(kind, sessionKey, sessionToken);
}

export async function releaseViewerSession(kind, sessionKey, sessionToken) {
    const entry = getSession(kind, sessionKey);
    if (!entry || entry.sessionToken !== sessionToken) {
        return { stopped: false, reason: 'stale-session' };
    }
    endSession(kind, sessionKey, sessionToken);
    const provider = getSessionProvider(kind);
    await provider.stop({ sessionKey, ...entry });
    return { stopped: true };
}

export async function forceStopViewerSession(kind, sessionKey) {
    const entry = getSession(kind, sessionKey);
    clearSession(kind, sessionKey);
    const provider = getSessionProvider(kind);
    await provider.stop({ sessionKey, ...entry });
    return { stopped: true };
}
