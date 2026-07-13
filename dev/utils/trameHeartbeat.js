import { API_URL } from '../config.js';
import {
    isViewerUserActive,
    getViewerIdleMs,
    getLastViewerActivityAt
} from './viewerActivity.js';

export async function sendTrameContainerHeartbeat({
    sessionToken,
    onIdleTimeout
} = {}) {
    const lastAt = getLastViewerActivityAt();
    if (lastAt > 0 && !isViewerUserActive() && (Date.now() - lastAt) >= getViewerIdleMs()) {
        await onIdleTimeout?.();
        return { idleTimedOut: true };
    }

    const body = {
        userActive: isViewerUserActive()
    };
    if (sessionToken) {
        body.sessionToken = sessionToken;
    }

    const response = await fetch(`${API_URL}/api/containers/heartbeat`, {
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

    return response.json();
}
