import { SESSION_KINDS } from './kinds.js';

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

export function getWatchdogIntervalMs() {
    return Number(
        process.env.VIEWER_SESSION_WATCHDOG_INTERVAL_MS
        || process.env.SLICER_GUI_WATCHDOG_INTERVAL_MS
        || 30000
    );
}
