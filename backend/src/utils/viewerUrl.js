import config from '../config/index.js';

export function getClientFacingProtocol(req) {
    const chain = req.headers['x-forwarded-proto'];
    if (chain) {
        const first = chain.split(',')[0].trim().toLowerCase();
        if (first === 'https' || first === 'http') return first;
    }
    const cf = req.headers['cf-visitor'];
    if (cf) {
        try {
            const scheme = JSON.parse(cf).scheme;
            if (scheme === 'https' || scheme === 'http') return scheme;
        } catch {
            /* ignore */
        }
    }
    return req.protocol === 'https' ? 'https' : 'http';
}

export function buildViewerFrontendUrl(req, sessionUserId, sessionPort = null, trameContext = null) {
    const remoteViewerBase = (trameContext?.viewerPublicBaseUrl || '').replace(/\/+$/, '');
    const globalOverride = (config.trame?.viewerPublicBaseUrl || '').replace(/\/+$/, '');
    const runtime = (trameContext?.runtime || process.env.TRAME_SESSION_RUNTIME || 'docker').trim().toLowerCase();
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const protocol = getClientFacingProtocol(req);

    // Remote GPU: browser hits app nginx; gpu-remote-viewer.conf proxies to Vast.
    if (remoteViewerBase && runtime === 'process' && sessionPort) {
        return `${protocol}://${host}/trame-session-port/${sessionPort}/`;
    }

    const override = remoteViewerBase || globalOverride;
    if (override) {
        if (runtime === 'process' && sessionPort) {
            return `${override}/trame-session-port/${sessionPort}/`;
        }
        return `${override}/trame-session/user-${sessionUserId}/`;
    }

    if (runtime === 'process' && sessionPort) {
        return `${protocol}://${host}/trame-session-port/${sessionPort}/`;
    }

    return `${protocol}://${host}/trame-session/user-${sessionUserId}/`;
}
