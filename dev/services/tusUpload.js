/**
 * Minimal resumable-upload client for the TUS 1.0.0 protocol (creation + chunked PATCH).
 *
 * Large files go up in small chunks, so the caller gets real progress, a dropped connection resumes
 * from the server's offset instead of restarting, and no single request is big enough to hit
 * proxy body limits. Written in-house (about 100 lines) because the app serves plain ES modules
 * with no bundler, and the reference client's dependencies are CommonJS.
 */

import { t } from '../i18n/index.js';

const TUS_VERSION = '1.0.0';
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CONSECUTIVE_FAILURES = 5;

/** `code` identifies failures the UI maps by kind, independent of the (translated) message. */
export class TusError extends Error {
    constructor(message, status = 0, code = null) {
        super(message);
        this.name = 'TusError';
        this.status = status;
        this.code = code;
    }
}

export const UPLOAD_NETWORK_ERROR = 'UPLOAD_NETWORK_ERROR';
const networkError = () => new TusError(t('errors.serverUnreachable'), 0, UPLOAD_NETWORK_ERROR);

function toBase64(text) {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function encodeMetadata(metadata) {
    return Object.entries(metadata)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key} ${toBase64(String(value))}`)
        .join(',');
}

function isAbort(err) {
    return err?.name === 'AbortError';
}

/** Worth retrying: network failure, timeouts, offset conflicts, and gateway/server errors. */
function isRetryableStatus(status) {
    return status === 0 || status === 408 || status === 409 || status === 423
        || status === 429 || status >= 500;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

/**
 * Default transport: XMLHttpRequest, because fetch cannot report upload progress.
 * A transport resolves { status, header(name) } and rejects with TusError(status 0) on network failure.
 */
export function xhrTransport({ method, url, headers = {}, body, onUploadProgress, signal }) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        xhr.withCredentials = true;
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        if (onUploadProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) onUploadProgress(event.loaded);
            };
        }
        xhr.onload = () => resolve({ status: xhr.status, header: (name) => xhr.getResponseHeader(name) });
        xhr.onerror = () => reject(networkError());
        xhr.ontimeout = () => reject(networkError());
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(body ?? null);
    });
}

/**
 * Upload `file` to a TUS endpoint.
 * @returns {Promise<{ uploadUrl: string }>} The upload's URL. Its id is the id of the *upload*, not of
 *   the server's file record, and the server forgets it once the upload ends; identify the resulting
 *   file with a token in `metadata` instead (see uploadFileResumable).
 */
export async function tusUpload({
    file,
    endpoint,
    metadata = {},
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    signal,
    transport = xhrTransport,
    retryDelayMs = 1000
}) {
    if (!file?.size) throw new TusError(t('uploads.errorEmptyFile'));
    const base = globalThis.location?.href || 'http://localhost/';
    const common = { 'Tus-Resumable': TUS_VERSION };
    const report = (sent) => onProgress?.(Math.min(sent, file.size), file.size);

    const created = await transport({
        method: 'POST',
        url: endpoint,
        headers: {
            ...common,
            'Upload-Length': String(file.size),
            'Upload-Metadata': encodeMetadata({
                filename_download: file.name,
                type: file.type || 'application/octet-stream',
                ...metadata
            })
        },
        signal
    });
    const location = created.header('Location');
    if (created.status !== 201 || !location) {
        throw new TusError(t('uploads.failed'), created.status);
    }
    const uploadUrl = new URL(location, new URL(endpoint, base)).href;

    /** Ask the server how much it actually has, so a retry never re-sends or skips bytes. */
    const serverOffset = async (fallback) => {
        try {
            const head = await transport({ method: 'HEAD', url: uploadUrl, headers: common, signal });
            const offset = Number(head.header('Upload-Offset'));
            if (head.status === 200 && Number.isFinite(offset) && offset >= 0) return Math.min(offset, file.size);
        } catch (err) {
            if (isAbort(err)) throw err;
        }
        return fallback;
    };

    let offset = 0;
    let failures = 0;
    report(0);
    while (offset < file.size) {
        const chunkStart = offset;
        const chunkEnd = Math.min(chunkStart + chunkSize, file.size);
        try {
            const response = await transport({
                method: 'PATCH',
                url: uploadUrl,
                headers: {
                    ...common,
                    'Upload-Offset': String(chunkStart),
                    'Content-Type': 'application/offset+octet-stream'
                },
                body: file.slice(chunkStart, chunkEnd),
                onUploadProgress: (loaded) => report(chunkStart + loaded),
                signal
            });
            if (response.status !== 204 && response.status !== 200) {
                throw new TusError(t('uploads.failed'), response.status);
            }
            const confirmed = Number(response.header('Upload-Offset'));
            offset = Number.isFinite(confirmed) && confirmed > chunkStart ? confirmed : chunkEnd;
            failures = 0;
            report(offset);
        } catch (err) {
            if (isAbort(err)) throw err;
            const status = err instanceof TusError ? err.status : 0;
            failures += 1;
            if (!isRetryableStatus(status) || failures > MAX_CONSECUTIVE_FAILURES) throw err;
            await sleep(retryDelayMs * 2 ** (failures - 1), signal);
            offset = await serverOffset(chunkStart);
        }
    }

    return { uploadUrl };
}
