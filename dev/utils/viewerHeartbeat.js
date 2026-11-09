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
export async function sendViewerHeartbeat({
    sessionToken,
    projectId = null,
    seatId = null,
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
    if (projectId != null && Number(projectId) > 0) {
        body.projectId = Number(projectId);
    }
    if (seatId != null && Number(seatId) > 0) {
        body.seatId = Number(seatId);
    }

    const response = await fetch(heartbeatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        const err = new Error(data?.error?.message || 'Heartbeat failed');
        err.status = response.status;
        err.code = data?.error?.code || null; // CASE_ACCESS_LOST: removed from the case
        err.caseIds = data?.error?.caseIds || [];
        throw err;
    }

    try {
        return await response.json();
    } catch {
        return { ok: true };
    }
}
