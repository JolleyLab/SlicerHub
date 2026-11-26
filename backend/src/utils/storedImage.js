/**
 * Images kept in storage (profile pictures, workflow icons): content types, checking what an
 * upload really is, and sending one back.
 */

import storage from '../storage/index.js';

export const IMAGE_MIME = Object.freeze({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
});

/**
 * The image type from a file's first bytes ('png' | 'jpg' | 'gif' | 'webp'), or null. Trust this,
 * not the file name or the browser's content type, for anything other people will be shown.
 */
export function sniffImageType(buffer) {
    const b = buffer || Buffer.alloc(0);
    const ascii = (start, end) => b.subarray(start, end).toString('latin1');
    if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return 'gif';
    if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    return null;
}

/**
 * Send a stored image: a redirect to a short-lived link when the storage backend offers one,
 * otherwise stream it with its content type (never sniffed by the browser).
 */
export async function sendStoredImage(res, key, { cacheControl = 'public, max-age=300' } = {}) {
    const presigned = await storage.getPresignedReadUrl(key, 300);
    if (presigned) return res.redirect(302, presigned);
    const ext = key.split('.').pop().toLowerCase();
    res.setHeader('Content-Type', IMAGE_MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return (await storage.openReadStream(key)).pipe(res);
}
