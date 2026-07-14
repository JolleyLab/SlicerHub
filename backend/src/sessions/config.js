import { SESSION_KINDS } from './kinds.js';

/** Attached viewer heartbeat TTL (must keep pinging while UI is open). */
export function getSessionTtlMs(kind) {
    if (kind === SESSION_KINDS.SLICER_GUI) {
        const slicerOverride = Number(process.env.SLICER_GUI_SESSION_TTL_SECONDS);
        if (Number.isFinite(slicerOverride) && slicerOverride > 0) {
            return slicerOverride * 1000;
        }
    }
    const ttlSeconds = Number(process.env.VIEWER_SESSION_TTL_SECONDS || 120);
    return ttlSeconds * 1000;
}

export function getSessionTtlSeconds(kind) {
    return Math.round(getSessionTtlMs(kind) / 1000);
}

/**
 * Soft-release / parked warm seat TTL (no browser heartbeat required).
 * Used for Full Slicer keep-alive after Close; reusable for remote seats later.
 */
export function getWarmIdleTtlMs(kind) {
    if (kind === SESSION_KINDS.SLICER_GUI) {
        const warm = Number(process.env.SLICER_GUI_WARM_IDLE_SECONDS);
        if (Number.isFinite(warm) && warm > 0) {
            return warm * 1000;
        }
        // Default 30 minutes when parked.
        return 30 * 60 * 1000;
    }
    // Trame and others: no longer parking — fall back to attached TTL.
    return getSessionTtlMs(kind);
}

export function getWarmIdleTtlSeconds(kind) {
    return Math.round(getWarmIdleTtlMs(kind) / 1000);
}

export function getWatchdogIntervalMs() {
    return Number(
        process.env.VIEWER_SESSION_WATCHDOG_INTERVAL_MS
        || process.env.SLICER_GUI_WATCHDOG_INTERVAL_MS
        || 30000
    );
}

export const VIEWER_RELEASE_MODES = Object.freeze({
    /** Keep runtime warm; extend lease to warm-idle TTL (no container stop). */
    SOFT: 'soft',
    /** End lease and stop the runtime (container / remote seat). */
    HARD: 'hard'
});

export function normalizeViewerReleaseMode(mode, { supportsSoft = false } = {}) {
    if (supportsSoft && String(mode || '').toLowerCase() === VIEWER_RELEASE_MODES.SOFT) {
        return VIEWER_RELEASE_MODES.SOFT;
    }
    return VIEWER_RELEASE_MODES.HARD;
}
