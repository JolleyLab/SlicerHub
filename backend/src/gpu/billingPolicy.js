export function getBillingPolicy() {
    const idleMinutes = Math.max(
        5,
        parseInt(process.env.GPU_BILLING_IDLE_MINUTES || '60', 10) || 60
    );
    const maxWallMinutes = parseInt(process.env.GPU_BILLING_MAX_WALL_MINUTES || '480', 10);
    return {
        idleMinutes,
        maxWallMinutes: Number.isFinite(maxWallMinutes) && maxWallMinutes > 0 ? maxWallMinutes : 0
    };
}

/** Grace period before stopping viewer after leaving the project page (same-tab navigation). */
export function getViewerLeaveGraceMinutes() {
    const raw = parseInt(process.env.GPU_VIEWER_LEAVE_GRACE_MINUTES || '10', 10);
    return Math.max(1, raw);
}

export function getViewerLeaveGraceMs() {
    return getViewerLeaveGraceMinutes() * 60 * 1000;
}

/** Align billing watchdog with trame viewer session TTL (default 30 min). */
export function getViewerSessionTtlMs() {
    const raw = parseInt(
        process.env.GPU_VIEWER_SESSION_TTL_SECONDS
            || process.env.SESSION_TTL_SECONDS
            || '1800',
        10
    );
    return Math.max(60, raw) * 1000;
}

function parseTs(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

export function computeBillingLease(instance) {
    if (!instance || instance.status !== 'running' || instance.providerId === 'local') {
        return null;
    }

    const { idleMinutes, maxWallMinutes } = getBillingPolicy();
    const lastMs = parseTs(instance.billingLastActivityAt)
        ?? parseTs(instance.provisionFinishedAt);
    const startedMs = parseTs(instance.provisionFinishedAt);

    const idleShutdownAt = lastMs
        ? new Date(lastMs + idleMinutes * 60 * 1000).toISOString()
        : null;
    const wallEndsAt = startedMs && maxWallMinutes > 0
        ? new Date(startedMs + maxWallMinutes * 60 * 1000).toISOString()
        : null;

    return {
        idleMinutes,
        maxWallMinutes: maxWallMinutes || null,
        viewerSessionTtlMinutes: Math.round(getViewerSessionTtlMs() / 60000),
        viewerLeaveGraceMinutes: getViewerLeaveGraceMinutes(),
        billingLastActivityAt: instance.billingLastActivityAt || null,
        idleShutdownAt,
        wallEndsAt
    };
}

export function shouldAutoStopBilling(instance, nowMs = Date.now()) {
    if (!instance || instance.status !== 'running' || instance.providerId === 'local') {
        return null;
    }

    const lease = computeBillingLease(instance);
    if (!lease) return null;

    if (lease.wallEndsAt && nowMs >= new Date(lease.wallEndsAt).getTime()) {
        return 'wall_cap';
    }

    if (lease.idleShutdownAt && nowMs >= new Date(lease.idleShutdownAt).getTime()) {
        return 'idle';
    }

    return null;
}

/** True when no viewer session should exist and last app activity exceeds viewer TTL. */
export function shouldStopBillingWithoutViewer(instance, nowMs = Date.now()) {
    if (!instance || instance.status !== 'running' || instance.providerId === 'local') {
        return false;
    }
    const lastMs = parseTs(instance.billingLastActivityAt)
        ?? parseTs(instance.provisionFinishedAt);
    if (!lastMs) return false;
    return (nowMs - lastMs) >= getViewerSessionTtlMs();
}
