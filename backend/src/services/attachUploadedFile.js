import { AppError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { directusFetch, createCaseAttachment } from './directus.js';
import { verifyUploadToken, uploadMarker } from './uploadTokens.js';

/**
 * Attach a finished resumable (TUS) upload to a case.
 *
 * Directus does not tell the client which file record an upload became: the id in the TUS upload URL
 * is not the file id, and Directus forgets the upload as soon as it completes. So each upload is tagged
 * with a server-issued token (uploadTokens.js) whose marker is written to the file's `description`, and
 * the file is found by that marker here. The token is bound to the user who started the upload, so it
 * cannot be used to link someone else's file.
 */

/** The id of the one file carrying this marker, or null when none (or more than one) does. */
async function findFileIdByMarker(nonce, { accessToken }, { fetchDirectus, log }) {
    const found = await fetchDirectus('/files', {
        accessToken,
        query: { 'filter[description][_eq]': uploadMarker(nonce), fields: 'id', limit: 2 }
    });
    const rows = Array.isArray(found?.data) ? found.data : [];
    if (rows.length !== 1 || !rows[0].id) {
        log.warn('from-upload: expected exactly one file for the upload marker', { matches: rows.length });
        return null;
    }
    return rows[0].id;
}

/**
 * @param {{ caseId: string, userId: string|number, uploadToken: string, displayName: string,
 *   fileMeta: object, accessToken: string }} input userId is the app user who is linking the file
 * @returns {Promise<{ attachment: object, fileId: string }>}
 * @throws AppError UPLOAD_TOKEN_INVALID (400) for a bad, expired or foreign token,
 *   UPLOAD_FILE_NOT_LINKABLE (502) when no single file carries the marker; Directus errors
 *   (permissions, etc.) pass through unchanged.
 */
export async function attachUploadedFileToCase(
    { caseId, userId, uploadToken, displayName, fileMeta, accessToken },
    {
        fetchDirectus = directusFetch,
        createAttachment = createCaseAttachment,
        log = console,
        secret
    } = {}
) {
    const nonce = verifyUploadToken(uploadToken, userId, secret ? { secret } : undefined);

    const fileId = await findFileIdByMarker(nonce, { accessToken }, { fetchDirectus, log });
    if (!fileId) {
        throw new AppError(msg('upload.file_not_linkable'), 502, 'UPLOAD_FILE_NOT_LINKABLE', 'upload.file_not_linkable');
    }

    const attachment = await createAttachment(caseId, fileId, displayName, { accessToken, fileMeta });

    // The marker only existed to find the file; clear it (best effort, purely cosmetic).
    try {
        await fetchDirectus(`/files/${encodeURIComponent(fileId)}`, {
            method: 'PATCH',
            accessToken,
            body: { description: null }
        });
    } catch (err) {
        log.warn('from-upload: could not clear the upload marker:', String(err.message).slice(0, 120));
    }
    return { attachment, fileId };
}
