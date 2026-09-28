/** Tracks real viewer interaction for walk-away safety (not just tab open). */

let lastActivityAt = 0;
let idleMs = 30 * 60 * 1000;
let listenersInstalled = false;

export function setViewerIdleMs(ms) {
    if (Number.isFinite(ms) && ms > 0) {
        idleMs = ms;
    }
}

export function markViewerActivity() {
    lastActivityAt = Date.now();
}

export function resetViewerActivity() {
    lastActivityAt = 0;
}

export function getLastViewerActivityAt() {
    return lastActivityAt;
}

export function getViewerIdleMs() {
    return idleMs;
}

export function isViewerUserActive(now = Date.now()) {
    if (!lastActivityAt) return false;
    return (now - lastActivityAt) < idleMs;
}

export function installViewerActivityListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    window.addEventListener('message', (event) => {
        if (event?.data?.type === 'slicer-viewer-activity') {
            markViewerActivity();
        }
    });

    const onParentActivity = () => markViewerActivity();
    ['mousedown', 'keydown', 'wheel', 'touchstart'].forEach((evt) => {
        window.addEventListener(evt, onParentActivity, { passive: true, capture: true });
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            markViewerActivity();
        }
    });
}
