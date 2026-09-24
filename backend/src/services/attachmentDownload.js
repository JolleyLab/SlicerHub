import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Serving a case attachment as a save-to-device download.
 *
 * The browser must not wait for the backend to pull the whole file from Directus before it gets its
 * first byte, so:
 *   - HEAD (the browser's preflight) only checks access and answers straight away;
 *   - GET serves the cached copy when there is one, and otherwise streams Directus' response through
 *     to the browser as it arrives.
 */

/**
 * Stream a Directus asset to the response. `fetchAsset(signal)` opens the upstream request and throws
 * a mapped error before any header is sent if Directus refuses. If the browser goes away (cancelled
 * download, closed tab) the upstream request is aborted, so nothing keeps downloading for nobody.
 */
export async function streamAssetToResponse(res, { fileName, fetchAsset }) {
    const abort = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded) abort.abort();
    });

    const upstream = await fetchAsset(abort.signal);
    res.attachment(fileName);
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    // Send the headers now: the browser starts the download (and can show it) as soon as Directus has
    // answered, without waiting for the first body bytes.
    res.flushHeaders();

    try {
        await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
        if (abort.signal.aborted || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // the client left
        // Headers are already on the wire, so an error body is no longer possible: cut the connection so
        // the browser reports a failed download instead of saving a truncated file.
        console.warn('Attachment download stream failed:', err?.message || err);
        res.destroy();
    }
}

/**
 * Express handler for GET/HEAD .../attachments/:id/download.
 * @param {object} deps
 * @param {(req) => Promise<object>} deps.authorize  throws unless the caller may download; returns the attachment
 * @param {(attachment) => ({ cachePath: string, fileName: string } | null)} deps.findCached
 * @param {(attachment, accessToken: string, signal: AbortSignal) => Promise<Response>} deps.fetchAsset
 */
export function createAttachmentDownloadHandler({ authorize, findCached, fetchAsset }) {
    return async function attachmentDownload(req, res) {
        const attachment = await authorize(req);
        const fileName = path.basename(attachment.filenameDownload || attachment.name || 'attachment');

        if (req.method === 'HEAD') {
            // Preflight: the caller has just been authorised, which is all it wanted to know.
            res.attachment(fileName);
            if (Number.isFinite(attachment.filesize)) res.setHeader('Content-Length', attachment.filesize);
            res.end();
            return;
        }

        const cached = findCached(attachment);
        if (cached) {
            res.download(path.resolve(cached.cachePath), cached.fileName);
            return;
        }
        await streamAssetToResponse(res, {
            fileName,
            fetchAsset: (signal) => fetchAsset(attachment, req.directusAccessToken, signal)
        });
    };
}
