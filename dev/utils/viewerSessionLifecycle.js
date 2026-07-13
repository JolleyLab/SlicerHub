/**
 * Shared browser-side viewer session lifecycle: heartbeats while open, release on tab close.
 */

const DEFAULT_HEARTBEAT_MS = 30000;
const RELEASE_DEFER_MS = 2000;
const PENDING_RELEASE_KEY = 'viewer-session-release-pending';

function isReloadUnload() {
    try {
        const entry = performance.getEntriesByType('navigation')[0];
        if (entry?.type === 'reload') {
            return true;
        }
    } catch {
        /* ignore */
    }
    try {
        if (performance.navigation?.type === 1) {
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

export function attachViewerSessionLifecycle({
    sessionToken,
    heartbeatUrl,
    stopUrl,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
    heartbeatBody,
    releaseOnUnload = true,
    onHeartbeatFailed
}) {
    if (!sessionToken || !heartbeatUrl || !stopUrl) {
        return { release: () => {}, stopHeartbeat: () => {} };
    }

    let released = false;
    let heartbeatTimer = null;
    let releaseTimer = null;

    const buildBody = (token) => {
        if (typeof heartbeatBody === 'function') {
            return heartbeatBody(token);
        }
        return { sessionToken: token };
    };

    const release = () => {
        if (released) return;
        released = true;
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (releaseTimer) {
            clearTimeout(releaseTimer);
            releaseTimer = null;
        }
        sessionStorage.removeItem(PENDING_RELEASE_KEY);
        fetch(stopUrl, {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(sessionToken))
        }).catch(() => {});
    };

    const sendHeartbeat = async () => {
        if (released) return;
        try {
            const response = await fetch(heartbeatUrl, {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildBody(sessionToken))
            });
            if (response.status === 404) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                onHeartbeatFailed?.();
            }
        } catch {
            /* retry on next interval */
        }
    };

    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    const cancelPendingRelease = () => {
        sessionStorage.removeItem(PENDING_RELEASE_KEY);
        if (releaseTimer) {
            clearTimeout(releaseTimer);
            releaseTimer = null;
        }
    };

    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs);

    if (releaseOnUnload) {
        // Reload starts a new document which clears the pending flag in pageshow.
        // Tab close leaves the flag and deferred release runs after a short delay.
        window.addEventListener('pageshow', cancelPendingRelease);

        window.addEventListener('pagehide', (event) => {
            if (event.persisted || isReloadUnload()) {
                return;
            }
            sessionStorage.setItem(PENDING_RELEASE_KEY, sessionToken);
            releaseTimer = setTimeout(() => {
                releaseTimer = null;
                if (sessionStorage.getItem(PENDING_RELEASE_KEY) !== sessionToken) {
                    return;
                }
                sessionStorage.removeItem(PENDING_RELEASE_KEY);
                release();
            }, RELEASE_DEFER_MS);
        });
    }

    return { release, stopHeartbeat, cancelPendingRelease };
}

export async function stopViewerSession({
    stopUrl,
    sessionToken,
    body = {},
    keepalive = false
}) {
    if (!stopUrl) return;
    const payload = sessionToken ? { sessionToken, ...body } : body;
    await fetch(stopUrl, {
        method: 'POST',
        credentials: 'include',
        keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(() => {});
}
