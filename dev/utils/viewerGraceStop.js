/** Per-project delayed viewer stop when leaving the project page (same-tab navigation). */

const pending = new Map();

export function getViewerLeaveGraceMs() {
    const minutes = parseInt(
        typeof window !== 'undefined' && window.__GPU_VIEWER_LEAVE_GRACE_MINUTES__
            ? window.__GPU_VIEWER_LEAVE_GRACE_MINUTES__
            : '10',
        10
    );
    return Math.max(1, minutes) * 60 * 1000;
}

export function scheduleViewerStopOnLeave(projectId, stopFn) {
    if (!projectId) return;
    cancelViewerStopOnLeave(projectId);
    const timer = setTimeout(() => {
        pending.delete(projectId);
        stopFn();
    }, getViewerLeaveGraceMs());
    pending.set(projectId, timer);
}

export function cancelViewerStopOnLeave(projectId) {
    if (!projectId) return;
    const timer = pending.get(projectId);
    if (!timer) return;
    clearTimeout(timer);
    pending.delete(projectId);
}
