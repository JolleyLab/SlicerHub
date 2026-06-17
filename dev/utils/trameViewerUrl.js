export function resolveTramePageUrl(frontendUrl) {
    if (!frontendUrl) return '';
    try {
        const u = new URL(frontendUrl, window.location.href);
        if (u.hostname !== window.location.hostname) {
            return u.href;
        }
        return `${window.location.origin}${u.pathname}${u.search}${u.hash}`;
    } catch {
        return frontendUrl;
    }
}

export function isRemoteTrameViewerUrl(url) {
    try {
        return new URL(url, window.location.href).hostname !== window.location.hostname;
    } catch {
        return false;
    }
}
