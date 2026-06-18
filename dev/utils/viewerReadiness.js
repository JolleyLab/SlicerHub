/** HTTP status that means the Trame viewer port is accepting connections. */
export function isViewerProbeReady(status) {
    if (!Number.isFinite(status) || status < 200) {
        return false;
    }
    // Trame's Vue shell often returns 403 on anonymous GET while WS/rendering is up.
    if (status === 403) {
        return true;
    }
    if (status >= 500) {
        return false;
    }
    return status < 400;
}

export async function probeViewerUrl(url, init = {}) {
    try {
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            ...init
        });
        return isViewerProbeReady(response.status);
    } catch {
        return false;
    }
}
