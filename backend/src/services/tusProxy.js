import { Readable } from 'stream';
import { msg } from '../i18n/index.js';

/**
 * Resumable (TUS) upload proxy to Directus `/files/tus`.
 *
 * The browser uploads a large file in small chunks through here; each chunk is streamed straight
 * to Directus with the caller's own access token (the browser never sees it). Nothing is buffered
 * whole, each request stays small enough for Cloudflare/nginx body limits, and the client gets real
 * progress and can resume after a dropped connection.
 */

export const TUS_PROXY_PATH = '/api/directus/files/tus';

const FORWARD_REQUEST_HEADERS = [
    'tus-resumable',
    'upload-length',
    'upload-offset',
    'upload-metadata',
    'upload-defer-length',
    'upload-checksum',
    'content-type',
    'content-length',
    'x-http-method-override'
];

const FORWARD_RESPONSE_HEADERS = [
    'tus-resumable',
    'tus-version',
    'tus-extension',
    'tus-max-size',
    'upload-offset',
    'upload-length',
    'upload-metadata',
    'upload-expires',
    'cache-control',
    'content-type'
];

const ALLOWED_METHODS = new Set(['POST', 'PATCH', 'HEAD', 'DELETE']);

/** The app's usual error body: { error: { message, code, key } }. */
function sendError(res, status, code, key) {
    res.status(status).json({ error: { message: msg(key), code, key } });
}

/** Directus answers with an absolute Location; point the client back at this proxy instead. */
export function rewriteTusLocation(location) {
    if (!location) return null;
    const match = /\/files\/tus\/([^/?#]+)/.exec(location);
    return match ? `${TUS_PROXY_PATH}/${match[1]}` : null;
}

export function createTusProxyHandler({ directusUrl }) {
    return async function tusProxy(req, res) {
        const uploadId = req.params.uploadId || '';
        const method = req.method.toUpperCase();
        // Creation is POST on the collection; everything else addresses one upload.
        if (!ALLOWED_METHODS.has(method) || (method === 'POST') === Boolean(uploadId)) {
            sendError(res, 405, 'METHOD_NOT_ALLOWED', 'upload.method_not_allowed');
            return;
        }

        const target = new URL(
            uploadId ? `/files/tus/${encodeURIComponent(uploadId)}` : '/files/tus',
            `${directusUrl}/`
        );
        const headers = { Authorization: `Bearer ${req.directusAccessToken}` };
        for (const name of FORWARD_REQUEST_HEADERS) {
            if (req.headers[name] !== undefined) headers[name] = req.headers[name];
        }

        const hasBody = (method === 'PATCH' || method === 'POST')
            && (Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding']);

        // Stop the upstream request if the browser goes away mid-chunk.
        const abort = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) abort.abort();
        });

        let upstream;
        try {
            upstream = await fetch(target, {
                method,
                headers,
                body: hasBody ? Readable.toWeb(req) : undefined,
                duplex: hasBody ? 'half' : undefined,
                signal: abort.signal
            });
        } catch (err) {
            if (abort.signal.aborted) return;
            console.error('Directus TUS proxy: request to Directus failed:', err.message || err);
            sendError(res, 502, 'FILE_SERVER_UNREACHABLE', 'upload.file_server_unreachable');
            return;
        }

        res.status(upstream.status);
        for (const name of FORWARD_RESPONSE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value !== null) res.setHeader(name, value);
        }
        const location = rewriteTusLocation(upstream.headers.get('location'));
        if (location) res.setHeader('Location', location);

        // 4xx answers (an offset conflict while resuming, an expired upload...) are ordinary protocol
        // traffic the client handles; only Directus failing is worth a log line.
        if (upstream.status >= 500) {
            console.warn('Directus TUS proxy: Directus answered', upstream.status, 'to', method);
        }
        if (!upstream.body) {
            res.end();
            return;
        }
        Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    };
}
