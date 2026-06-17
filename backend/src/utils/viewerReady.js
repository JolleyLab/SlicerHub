import http from 'http';
import https from 'https';

function probeUrl(url, timeoutMs = 5000) {
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

export function buildInternalViewerCheckUrl(sessionPort, trameContext) {
    if (trameContext?.viewerPublicBaseUrl) {
        return `http://nginx:80/trame-session-port/${sessionPort}/`;
    }
    return `http://trame-service:${sessionPort}/`;
}

export async function waitForViewerReady(checkUrl, { maxWaitMs = 120000, intervalMs = 400 } = {}) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        try {
            const status = await probeUrl(checkUrl);
            if (status >= 200 && status < 400) {
                return true;
            }
        } catch (_) {
            // keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}
