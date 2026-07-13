import https from 'https';
import http from 'http';
import Docker from 'dockerode';
import { SESSION_KINDS } from '../kinds.js';
import { getSession } from '../leaseRegistry.js';
import {
    resolveTrameServiceUrl,
    resolveLocalTrameServiceUrl,
    getUserTrameContext,
    setUserTrameContext
} from '../../gpu/sessionContext.js';
import { evaluateRemoteBillingStop } from '../../gpu/orchestrator.js';

const docker = new Docker({
    socketPath: process.env.DOCKER_HOST?.replace('unix://', '') || '/var/run/docker.sock'
});

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

function resolveTrameUrls(userId, metadata = {}) {
    const urls = [];
    const projectId = Number(metadata.projectId) || null;
    if (metadata.trameServiceUrl) {
        urls.push(metadata.trameServiceUrl);
    }
    if (projectId) {
        const ctx = getUserTrameContext(userId);
        if (ctx?.trameServiceUrl && !urls.includes(ctx.trameServiceUrl)) {
            urls.push(ctx.trameServiceUrl);
        }
    }
    const localUrl = resolveLocalTrameServiceUrl();
    if (!urls.includes(localUrl)) {
        urls.push(localUrl);
    }
    return urls;
}

export async function stopTrameViewerSession({
    sessionKey,
    metadata = {}
}) {
    const userId = String(sessionKey);
    const urls = resolveTrameUrls(userId, metadata);
    let stopped = false;
    let sessionId = metadata.sessionId || null;

    for (const trameServiceUrl of urls) {
        try {
            const sessions = await httpRequest(`${trameServiceUrl}/api/sessions`);
            const userSession = sessions.sessions?.find((s) => s.userId === userId);
            if (!userSession) continue;
            sessionId = userSession.sessionId;
            await httpRequest(
                `${trameServiceUrl}/api/sessions/${userSession.sessionId}/stop`,
                { method: 'POST' }
            );
            stopped = true;
            break;
        } catch (err) {
            console.warn(`Stop Trame session skipped for ${trameServiceUrl}:`, err.message);
        }
    }

    const projectId = Number(metadata.projectId) || null;
    const ctx = getUserTrameContext(userId);
    if (!projectId || ctx?.projectId === projectId) {
        setUserTrameContext(userId, null);
    }

    if (stopped && projectId) {
        try {
            await evaluateRemoteBillingStop(projectId, { viewerActive: false });
        } catch (err) {
            console.warn(`Billing evaluation after Trame stop (project ${projectId}):`, err.message);
        }
    }

    return { stopped, sessionId, userId };
}

/**
 * Stop only the local Trame viewer for a user (compose trame-service + trame-{userId}).
 * Does not contact remote/Vast trame-service or evaluate GPU billing.
 */
export async function stopLocalTrameViewerSession({ sessionKey }) {
    const userId = String(sessionKey);
    let stopped = false;
    const localUrl = resolveLocalTrameServiceUrl();

    try {
        const sessions = await httpRequest(`${localUrl}/api/sessions`);
        const userSession = sessions.sessions?.find((s) => s.userId === userId);
        if (userSession) {
            await httpRequest(
                `${localUrl}/api/sessions/${userSession.sessionId}/stop`,
                { method: 'POST' }
            );
            stopped = true;
        }
    } catch (err) {
        console.warn(`Stop local Trame session via trame-service for ${userId}:`, err.message);
    }

    const containerName = `trame-${userId}`;
    try {
        const container = docker.getContainer(containerName);
        await container.remove({ force: true });
        stopped = true;
    } catch (err) {
        if (err.statusCode !== 404) {
            console.warn(`Remove local Trame container ${containerName}:`, err.message);
        }
    }

    setUserTrameContext(userId, null);

    return { stopped, userId, localOnly: true };
}

export async function listPerUserTrameContainers() {
    const containers = await docker.listContainers({ all: true });
    return containers
        .filter((item) => {
            const name = (item.Names?.[0] || '').replace(/^\//, '');
            return name.startsWith('trame-') && name !== 'trame-service' && name !== 'trame-job';
        })
        .map((item) => {
            const name = (item.Names?.[0] || '').replace(/^\//, '');
            const userId = item.Labels?.user || name.slice('trame-'.length);
            return { sessionKey: userId, containerName: name, state: item.State };
        });
}

export async function stopAllPerUserTrameContainers() {
    const running = await listPerUserTrameContainers();
    for (const { sessionKey, containerName } of running) {
        try {
            await stopTrameViewerSession({ sessionKey });
            console.log(`Stopped Trame container ${containerName} on startup`);
        } catch (err) {
            console.warn(`Failed to stop Trame container ${containerName}:`, err.message);
        }
    }
}

export const trameProvider = {
    kind: SESSION_KINDS.TRAME,
    async stop({ sessionKey, metadata = {} }) {
        return stopTrameViewerSession({ sessionKey, metadata });
    },
    async listOrphans() {
        const running = await listPerUserTrameContainers();
        return running.filter(({ sessionKey }) => !getSession(SESSION_KINDS.TRAME, sessionKey));
    }
};
