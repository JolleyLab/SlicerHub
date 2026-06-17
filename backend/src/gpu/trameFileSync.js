import http from 'http';
import https from 'https';
import storage from '../storage/index.js';

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

function getSyncToken(instance) {
    const token = instance?.metadata?.syncToken;
    if (!token) {
        throw new Error('GPU instance is missing sync token — reprovision billing');
    }
    return token;
}

async function remoteFileMatches(instance, { userId, fileName, localBytes }, authHeaders) {
    if (localBytes == null) return false;
    const base = instance.trameServiceUrl.replace(/\/+$/, '');
    const encodedUser = encodeURIComponent(String(userId));
    const encodedFile = encodeURIComponent(String(fileName).replace(/[/\\]/g, ''));
    try {
        const remote = await httpJson(`${base}/api/files/${encodedUser}/${encodedFile}/stat`, {
            method: 'GET',
            headers: authHeaders
        });
        return remote?.bytes === localBytes;
    } catch {
        return false;
    }
}

export async function syncFileToTrame(instance, { userId, storageKey, fileName }, { localBytes = null } = {}) {
    const syncToken = getSyncToken(instance);
    const base = instance.trameServiceUrl.replace(/\/+$/, '');
    const safeUserId = String(userId);
    const safeFile = String(fileName).replace(/[/\\]/g, '');
    const key = storage.normalizeKey(storageKey);
    const authHeaders = { Authorization: `Bearer ${syncToken}` };

    if (!(await storage.exists(key))) {
        throw new Error(`Scene not found in storage: ${key}`);
    }

    const bytes = localBytes ?? (await storage.stat(key)).size;
    if (await remoteFileMatches(instance, { userId: safeUserId, fileName: safeFile, localBytes: bytes }, authHeaders)) {
        return { status: 'skipped', bytes };
    }

    // Object storage: GPU pulls via temporary HTTPS URL (no bytes through backend).
    const readUrl = await storage.getPresignedReadUrl(key, 900);
    if (readUrl) {
        return httpJson(`${base}/api/files/pull`, {
            method: 'POST',
            headers: authHeaders,
            body: { userId: safeUserId, fileName: safeFile, sourceUrl: readUrl }
        });
    }

    // Local disk: stream upload to trame.
    const stream = await storage.openReadStream(key);
    const encodedUser = encodeURIComponent(safeUserId);
    const encodedFile = encodeURIComponent(safeFile);
    return httpPutStream(
        `${base}/api/files/${encodedUser}/${encodedFile}`,
        stream,
        { headers: authHeaders }
    );
}
