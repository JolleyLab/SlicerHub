import { API_URL } from '../config.js';
import {
    isViewerUserActive,
    getViewerIdleMs,
    getLastViewerActivityAt
} from './viewerActivity.js';

/**
 * Ping a viewer session lease. Optionally close on client-side idle timeout.
 * Works for Trame and Full Slicer (pass heartbeatUrl from getViewerSessionEndpoints).
 */
export async function sendTrameContainerHeartbeat({
    sessionToken,
    onIdleTimeout,
    heartbeatUrl = `${API_URL}/api/containers/heartbeat`,
    includeUserActive = true
} = {}) {
    const lastAt = getLastViewerActivityAt();
    if (lastAt > 0 && !isViewerUserActive() && (Date.now() - lastAt) >= getViewerIdleMs()) {
        await onIdleTimeout?.();
        return { idleTimedOut: true };
    }

    const body = {};
    if (includeUserActive) {
        body.userActive = isViewerUserActive();
    }
    if (sessionToken) {
        body.sessionToken = sessionToken;
    }

    const response = await fetch(heartbeatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = new Error('Heartbeat failed');
        err.status = response.status;
        throw err;
    }

    try {
        return await response.json();
    } catch {
        return { ok: true };
    }
}
