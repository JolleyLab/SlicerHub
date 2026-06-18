import http from 'http';
import https from 'https';

function probeUrl(url, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout: timeoutMs
        }, (res) => {
            res.resume();
            resolve(res.statusCode || 0);
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.end();
    });
}

export function isLocalDockerSession(trameContext) {
    if (trameContext) return false;
    const runtime = (process.env.TRAME_SESSION_RUNTIME || 'docker').trim().toLowerCase();
    return runtime === 'docker';
}

export function buildInternalViewerCheckUrl(sessionUserId, sessionPort, trameContext) {
    if (trameContext?.viewerPublicBaseUrl) {
        return `http://nginx:80/trame-session-port/${sessionPort}/`;
    }

    const runtime = (trameContext?.runtime || process.env.TRAME_SESSION_RUNTIME || 'docker')
        .trim()
        .toLowerCase();
    if (runtime === 'process') {
        return `http://trame-service:${sessionPort}/`;
    }

    const userId = String(sessionUserId || '').trim();
    if (!userId) {
        return `http://trame-service:${sessionPort}/`;
    }
    // Docker sessions listen on 9000 inside trame-session-{userId}, not on trame-service.
    return `http://trame-session-${userId}:9000/`;
}

export async function waitForViewerReady(checkUrl, { maxWaitMs = 120000, intervalMs = 400 } = {}) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        try {
            const status = await probeUrl(checkUrl);
            // Trame often returns 403 on GET while the viewer port is up.
            if (status >= 200 && status < 400 || status === 403) {
                return true;
            }
        } catch (_) {
            // keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}
