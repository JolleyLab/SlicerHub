import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

/**
 * One-time tokens that tie a resumable upload to the user who started it.
 *
 * Directus does not report which file record an upload became, and forgets the upload when it
 * completes (see attachUploadedFile.js). So the server issues each upload a token, and the file is
 * tagged with a marker derived from it; linking the file to a case later needs the token back.
 * Issuing it here means the client never chooses or formats it: the server also returns the exact
 * metadata to send, so the marker format lives in this file only.
 *
 * A token is a signed, expiring JWT bound to the user, so it cannot be used by anyone else, cannot be
 * forged, and stops working after a day. It is signed with a key derived for this purpose, so it can
 * never pass as a session or share-link JWT (which use the raw secret).
 */

const PURPOSE = 'directus-upload-link';
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const NONCE_RE = /^[0-9a-f]{32}$/;
/** How an in-flight upload's file is recognised in Directus (written to the file's description). */
const MARKER_PREFIX = 'slicerweb-upload:';

const signingKey = (secret) => crypto.createHmac('sha256', secret).update(PURPOSE).digest();

/** The description marker for an upload's nonce. */
export function uploadMarker(nonce) {
    return `${MARKER_PREFIX}${nonce}`;
}

/**
 * @returns {{ uploadToken: string, metadata: { description: string } }} `metadata` is what the client
 *   must send with the upload (TUS Upload-Metadata), unchanged.
 */
export function issueUploadToken(
    userId,
    { secret = config.jwt.secret, expiresInSeconds = TOKEN_TTL_SECONDS } = {}
) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const uploadToken = jwt.sign({ purpose: PURPOSE, nonce }, signingKey(secret), {
        algorithm: 'HS256',
        subject: String(userId),
        expiresIn: expiresInSeconds
    });
    return { uploadToken, metadata: { description: uploadMarker(nonce) } };
}

/**
 * @returns {string} the nonce the token was issued with
 * @throws AppError UPLOAD_TOKEN_INVALID (400) when it is missing, forged, expired or another user's
 */
export function verifyUploadToken(uploadToken, userId, { secret = config.jwt.secret } = {}) {
    try {
        const claims = jwt.verify(String(uploadToken || ''), signingKey(secret), {
            algorithms: ['HS256'],
            subject: String(userId)
        });
        if (claims.purpose === PURPOSE && NONCE_RE.test(claims.nonce)) return claims.nonce;
    } catch {
        /* fall through to the single error below */
    }
    throw new AppError(msg('upload.token_invalid'), 400, 'UPLOAD_TOKEN_INVALID', 'upload.token_invalid');
}
