import http from 'http';
import https from 'https';
import path from 'path';
import crypto from 'crypto';
import storage from '../storage/index.js';
import ProjectGpu from '../models/ProjectGpu.js';

/**
 * Vast Full Slicer control plane (thin bridge on the GPU node).
 * Desktop image is swappable via SLICER_GUI_BASE_IMAGE; this module only talks HTTP.
 */

export function isVastFullSlicerMode() {
    return String(process.env.VAST_GPU_MODE || 'trame').trim().toLowerCase() === 'full-slicer';
}

export function remoteFullSlicerViewerPath() {
    return '/remote-slicer-gui/slicer-vnc.html?autoconnect=true&scale=true&quality=9';
}

function getSyncToken(instance) {
    const token = instance?.metadata?.syncToken;
    if (!token) {
        throw new Error('GPU instance is missing sync token — reprovision billing');
    }
    return token;
}

function httpJson(url, { method = 'POST', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const payload = body ? JSON.stringify(body) : null;
        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                ...headers,
                ...(payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(data ? JSON.parse(data) : {});
                    } catch {
                        resolve({ raw: data });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function httpPutStream(url, stream, { headers = {} }) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'PUT',
            headers
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(data ? JSON.parse(data) : {});
                    } catch {
                        resolve({ raw: data });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        stream.on('error', reject);
        stream.pipe(req);
    });
}

async function remoteFileMatches(instance, stagedName, localBytes, authHeaders) {
    if (localBytes == null) return false;
    const base = instance.trameServiceUrl.replace(/\/+$/, '');
    try {
        const remote = await httpJson(
            `${base}/api/files/${encodeURIComponent(stagedName)}/stat`,
            { method: 'GET', headers: authHeaders }
        );
        return remote?.bytes === localBytes;
    } catch {
        return false;
    }
}

function stagedNameForFile(file) {
    const safeName = path.basename(file.original_name || file.file_path);
    return `${file.id}-${safeName}`;
}

/**
 * Upload scene into /home/slicer/data on the Vast Full Slicer node (skip if size matches).
 */
export async function syncFileToRemoteFullSlicer(instance, {
    storageKey,
    file,
    localBytes = null
} = {}) {
    const syncToken = getSyncToken(instance);
    const authHeaders = { Authorization: `Bearer ${syncToken}` };
    const key = storage.normalizeKey(storageKey);
    if (!(await storage.exists(key))) {
        throw new Error(`Scene not found in storage: ${key}`);
    }
    const bytes = localBytes ?? (await storage.stat(key)).size;
    const stagedName = stagedNameForFile(file);

    if (await remoteFileMatches(instance, stagedName, bytes, authHeaders)) {
        return {
            status: 'skipped',
            bytes,
            stagedName,
            cacheKey: stagedName,
            workKey: stagedName
        };
    }

    const base = instance.trameServiceUrl.replace(/\/+$/, '');
    const stream = await storage.openReadStream(key);
    const put = await httpPutStream(
        `${base}/api/files/${encodeURIComponent(stagedName)}`,
        stream,
        { headers: authHeaders }
    );
    console.log(`Vast Full Slicer upload: ${stagedName} (${put?.bytes ?? bytes} bytes)`);
    return {
        status: 'uploaded',
        bytes: put?.bytes ?? bytes,
        stagedName,
        cacheKey: stagedName,
        workKey: stagedName
    };
}

/**
 * Upload (if needed) then write .open-request.json for slicer_session.py.
 */
export async function openFileOnRemoteFullSlicer(instance, {
    file,
    launcherUserId,
    useSimplifiedViewer = false,
    storageKey = null
} = {}) {
    const key = storage.normalizeKey(storageKey || file.file_path);
    let syncKey = key;
    if (file.user_id !== Number(launcherUserId) && String(file.user_id) !== String(launcherUserId)) {
        const safeName = path.basename(file.original_name || file.file_path);
        syncKey = await storage.ensureStagedCopy({
            sourceKey: key,
            userId: launcherUserId,
            fileName: `shared-${file.id}-${safeName}`
        });
    }

    const syncResult = await syncFileToRemoteFullSlicer(instance, {
        storageKey: syncKey,
        file
    });

    const syncToken = getSyncToken(instance);
    const authHeaders = { Authorization: `Bearer ${syncToken}` };
    const base = instance.trameServiceUrl.replace(/\/+$/, '');
    const openResult = await httpJson(`${base}/api/open`, {
        method: 'POST',
        headers: authHeaders,
        body: {
            fileId: file.id,
            fileName: path.basename(file.original_name || file.file_path),
            stagedName: syncResult.stagedName,
            useSimplifiedViewer: useSimplifiedViewer === true
        }
    });

    return {
        ...syncResult,
        containerPath: openResult.containerPath,
        fileName: path.basename(file.original_name || file.file_path),
        useSimplifiedViewer: useSimplifiedViewer === true
    };
}

export function issueRemoteFullSlicerSession({ projectId, userId, fileId }) {
    const sessionToken = crypto.randomBytes(24).toString('hex');
    ProjectGpu.patchMetadata(projectId, (meta) => ({
        ...meta,
        remoteFullSlicerSession: {
            sessionToken,
            userId: String(userId),
            fileId: Number(fileId) || null,
            issuedAt: new Date().toISOString()
        }
    }));
    return sessionToken;
}

export function validateRemoteFullSlicerSession({ projectId, userId, sessionToken }) {
    const instance = ProjectGpu.getInstance(projectId);
    const sess = instance?.metadata?.remoteFullSlicerSession;
    if (!sess?.sessionToken || sess.sessionToken !== sessionToken) return false;
    if (String(sess.userId) !== String(userId)) return false;
    return true;
}
