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

