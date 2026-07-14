import {
    beginSession,
    clearSession,
    createSessionToken,
    endSession,
    getSession,
    parkSession,
    touchSession
} from './leaseRegistry.js';
import {
    getSessionTtlSeconds,
    getWarmIdleTtlSeconds,
    normalizeViewerReleaseMode,
    VIEWER_RELEASE_MODES
} from './config.js';
import { getSessionProvider } from './watchdog.js';
import { SESSION_KINDS } from './kinds.js';

export {
    createSessionToken,
    getSessionTtlSeconds,
    getWarmIdleTtlSeconds,
    VIEWER_RELEASE_MODES
};

export function registerViewerSession(kind, sessionKey, options = {}) {
    return beginSession(kind, sessionKey, options);
}

export function touchViewerSession(kind, sessionKey, sessionToken) {
    return touchSession(kind, sessionKey, sessionToken);
}

/**
 * Release a viewer seat.
 * - hard: end lease + stop runtime (default)
 * - soft: park lease (warm idle); keep runtime for fast reopen (Full Slicer)
 */
export async function releaseViewerSession(kind, sessionKey, sessionToken, {
    mode = VIEWER_RELEASE_MODES.HARD
} = {}) {
    const supportsSoft = kind === SESSION_KINDS.SLICER_GUI;
    const releaseMode = normalizeViewerReleaseMode(mode, { supportsSoft });

    const entry = getSession(kind, sessionKey);
    if (!entry || entry.sessionToken !== sessionToken) {
        return { stopped: false, parked: false, reason: 'stale-session' };
    }

    if (releaseMode === VIEWER_RELEASE_MODES.SOFT) {
        const parked = parkSession(kind, sessionKey, sessionToken);
        if (!parked) {
            return { stopped: false, parked: false, reason: 'stale-session' };
        }
        return {
            stopped: false,
            parked: true,
            mode: VIEWER_RELEASE_MODES.SOFT,
            leaseExpiresAt: new Date(parked.leaseExpiresAt).toISOString(),
            warmIdleSeconds: getWarmIdleTtlSeconds(kind)
        };
    }

    endSession(kind, sessionKey, sessionToken);
    const provider = getSessionProvider(kind);
    await provider.stop({ sessionKey, ...entry });
    return { stopped: true, parked: false, mode: VIEWER_RELEASE_MODES.HARD };
}

export async function forceStopViewerSession(kind, sessionKey) {
    const entry = getSession(kind, sessionKey);
    clearSession(kind, sessionKey);
    const provider = getSessionProvider(kind);
    await provider.stop({ sessionKey, ...entry });
    return { stopped: true, parked: false, mode: VIEWER_RELEASE_MODES.HARD };
}
