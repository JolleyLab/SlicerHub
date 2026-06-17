import http from 'http';
import https from 'https';
import { getViewerSessionTtlMs } from './billingPolicy.js';

function httpGetJson(url, timeoutMs = 8000) {
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
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Probe remote trame-service for live viewer sessions (lease not expired).
 */
export async function probeRemoteTrameActivity(trameServiceUrl) {
    const base = String(trameServiceUrl || '').replace(/\/+$/, '');
    if (!base) {
        return { sessionCount: 0, hasActiveSession: false };
    }

    try {
        const data = await httpGetJson(`${base}/api/sessions`);
        const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
        const now = Date.now();
        const viewerTtlMinutes = getViewerSessionTtlMs() / 60000;
        const activeSessions = sessions.filter((session) => {
            const leaseMs = session.leaseExpiresAt
                ? new Date(session.leaseExpiresAt).getTime()
                : null;
            if (leaseMs && leaseMs > now) return true;
            const idleMinutes = Number(session.idleMinutes);
            if (Number.isFinite(idleMinutes) && idleMinutes < viewerTtlMinutes) return true;
            return false;
        });

        return {
            sessionCount: sessions.length,
            activeSessionCount: activeSessions.length,
            hasActiveSession: activeSessions.length > 0
        };
    } catch (err) {
        return {
            sessionCount: 0,
            activeSessionCount: 0,
            hasActiveSession: false,
            unreachable: true,
            error: err.message
        };
    }
}
