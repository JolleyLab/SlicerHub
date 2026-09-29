import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';
import { tusUpload } from './tusUpload.js';
export { saveWithDirectusReconnect } from './directusRetry.js';

async function parseJson(response) {
    try {
        return await response.json();
    } catch (_) {
        return {};
    }
}

/**
 * Map API errors to short user-facing copy.
 * Never show Directus ACL / collection / field jargon.
 */
export function friendlyCasesError(raw, fallback = 'Something went wrong. Please try again.', status = 0, code = null) {
    const text = String(raw || '').trim();
    const lower = text.toLowerCase();

    if (
        /sign in once with your email and password|account connection expired|connect to your account/i.test(lower)
    ) {
        return text;
    }

    // Upload transport failures carry a code, so this does not depend on the message wording.
    if (code === 'UPLOAD_NETWORK_ERROR') {
        return t('errors.serverUnreachable');
    }

    if (
        code === 'CASE_COLLABORATORS_UPDATE_FAILED'
        || code === 'CASE_OWNER_JUNCTION_MISSING'
        || code === 'CASE_COLLABORATOR_JUNCTION_NOT_FOUND'
    ) {
        return t('errors.peopleSaveFailed');
    }

    if (
        /only case admins can|collaborators can invite|pending invite|already on this case|already has a pending/i.test(lower)
        && text.length <= 160
        && !/directus|collection|case_directus|grant |token|probe|INTERNAL_SERVER/i.test(lower)
    ) {
        return text;
    }

    if (status === 401 || /unauthorized|session expired|jwt expired/i.test(lower)) {
        return t('errors.sessionExpired');
    }
    if (
        status === 403
        || /permission|forbidden|access fields|access collection|not allowed to|denied|directus:/i.test(lower)
    ) {
        return t('errors.noPermission');
    }
    if (/no (directus )?user found with that email/i.test(lower)) {
        return t('errors.noAccountWithEmail');
    }
    if (status === 404 || /\bnot found\b/i.test(lower)) {
        return t('errors.itemNotFound');
    }
    if (status === 413 || /file too large|payload too large|entity too large/i.test(lower)) {
        return t('errors.fileTooLarge');
    }
    if (/network|failed to fetch|load failed|econnrefused|timed out|timeout/i.test(lower)) {
        return t('errors.serverUnreachable');
    }
    if (/slicer-gui|container|docker|image built|vnc|seat/i.test(lower)) {
        return t('errors.viewerStartFailed');
    }
    if (/sessionToken|session not found|session.*expired|heartbeat/i.test(lower)) {
        return t('errors.viewerSessionEnded');
    }
    if (/multipart|file field is required/i.test(lower)) {
        return t('errors.chooseFile');
    }
    if (/title.*(required|empty)|case title is required/i.test(lower)) {
        return t('errors.titleRequired');
    }
    if (/browser preview/i.test(lower)) {
        return t('errors.browserPreviewUnavailable');
    }
    if (/cannot be opened in full slicer|file type cannot/i.test(lower)) {
        return t('errors.fileTypeNotSupported');
    }
    if (/couldn't update people|could not update people/i.test(lower)) {
        return t('errors.peopleSaveFailed');
    }
    if (/directus|collection |queried in|invalid payload|unknown field|filter\[|case_directus|INTERNAL_SERVER/i.test(lower)) {
        return fallback;
    }

    if (text && text.length <= 140 && !/[`{}[\]<>]|_\w+_|\.\w+\./.test(text)) {
        return text;
    }

    return fallback;
}

function throwApiError(response, data, fallback) {
    const raw = data?.error?.message || data?.message || '';
    const err = new Error(friendlyCasesError(raw, fallback, response.status, data?.error?.code));
    err.status = response.status;
    err.code = data?.error?.code || null;
    err.rawMessage = raw;
    if (err.code === 'DIRECTUS_SESSION_EXPIRED' || err.code === 'DIRECTUS_SESSION_REQUIRED') {
        window.dispatchEvent(new CustomEvent('directus-session-expired'));
    }
    throw err;
}

export async function listDirectusCases({ limit = 50 } = {}) {
    const response = await fetch(`${API_URL}/api/directus/cases?limit=${limit}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.loadCasesFailed'));
    }
    return data;
}

export async function createDirectusCase({ title, description, status } = {}) {
    const response = await fetch(`${API_URL}/api/directus/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, description, status })
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.createCaseFailed'));
    }
    return data;
}

export async function updateDirectusCase(caseId, updates = {}) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(updates)
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.updateCaseFailed'));
    }
    return data;
}

export async function createDirectusCaseComment(caseId, comment) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/comments`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ comment })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.sendCommentFailed'));
    }
    return data;
}

/**
 * Ask the server to start an upload. It returns a one-time token bound to this user, and the metadata
 * to send with the upload so the file can be recognised afterwards. Both are opaque to the client.
 * @returns {Promise<{ uploadToken: string, metadata: Record<string, string> }>}
 */
async function requestUploadToken() {
    const response = await fetch(`${API_URL}/api/directus/uploads/token`, {
        method: 'POST',
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.uploadFileFailed'));
    }
    return data;
}

/**
 * Phase 1 of adding a file to a case: send the bytes to Directus as a resumable, chunked upload
 * (progress, resume after a dropped connection, no proxy body-size limit).
 * @param {{ onProgress?: (sent: number, total: number) => void, signal?: AbortSignal,
 *   transport?: Function }} [options] transport is only for tests (see tusUpload)
 * @returns {Promise<{ uploadToken: string }>} pass the token to attachUploadedFile
 */
export async function uploadFileResumable(file, { onProgress, signal, transport } = {}) {
    // Directus does not report which file an upload became and forgets the upload when it completes,
    // so the server issues a token and the metadata that lets it find the file afterwards.
    const { uploadToken, metadata } = await requestUploadToken();
    await tusUpload({
        file,
        endpoint: `${API_URL}/api/directus/files/tus`,
        metadata,
        onProgress,
        signal,
        transport
    });
    return { uploadToken };
}

/**
 * Phase 2: link an uploaded Directus file to a case as an attachment.
 * @returns {Promise<object>} the new attachment
 */
export async function attachUploadedFile(caseId, { uploadToken, name, type = '', size = null }) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/attachments/from-upload`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadToken, name, type, size })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.uploadFileFailed'));
    }
    return data.attachment;
}

export async function deleteDirectusCaseAttachment(caseId, attachmentId) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}`,
        {
            method: 'DELETE',
            credentials: 'include'
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.deleteFileFailed'));
    }
    return data;
}

export async function lookupDirectusUserByEmail(email) {
    const response = await fetch(
        `${API_URL}/api/directus/users/lookup?email=${encodeURIComponent(email)}`,
        { method: 'GET', credentials: 'include', cache: 'no-store' }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.lookupUserFailed'));
    }
    return data.user;
}

export async function updateDirectusCaseCollaborators(caseId, collaborators) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/collaborators`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ collaborators })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.updatePeopleFailed'));
    }
    return data;
}

export async function inviteDirectusCaseUser(caseId, { email, role = 'collaborator' } = {}) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/invites`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, role })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.sendInviteFailed'));
    }
    return data;
}

export async function listDirectusCaseInvites(caseId) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/invites`,
        { method: 'GET', credentials: 'include', cache: 'no-store' }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.loadInvitesFailed'));
    }
    return data.invites || [];
}

/** Invites across all cases that the signed-in user can approve or reject. */
export async function listInvitesAwaitingMyApproval() {
    const response = await fetch(`${API_URL}/api/directus/invites/pending-approval`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.loadInvitesFailed'));
    }
    return data.invites || [];
}

/** Recent invite activity (sent, approved) on the user's cases, newest first. */
export async function listRecentActivity() {
    const response = await fetch(`${API_URL}/api/directus/activity/recent`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.loadActivityFailed'));
    }
    return data.events || [];
}

export async function approveDirectusCaseInvite(caseId, inviteId, { kind } = {}) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/invites/${encodeURIComponent(inviteId)}/approve`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ kind: kind || 'existing' })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.approveInviteFailed'));
    }
    return data;
}

export async function rejectDirectusCaseInvite(caseId, inviteId, { kind } = {}) {
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/invites/${encodeURIComponent(inviteId)}/reject`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ kind: kind || 'existing' })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.rejectInviteFailed'));
    }
    return data;
}

export async function previewSignupInvite(token) {
    const response = await fetch(
        `${API_URL}/api/invites/signup/${encodeURIComponent(token)}`,
        { method: 'GET', cache: 'no-store' }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.invalidInviteLink'));
    }
    return data;
}

export async function acceptSignupInvite(token, { password, username, firstName, lastName, theme } = {}) {
    const response = await fetch(
        `${API_URL}/api/invites/signup/${encodeURIComponent(token)}/accept`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ password, username, firstName, lastName, theme })
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.createAccountFailed'));
    }
    return data;
}

export {
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    invalidateNotifications
} from './notifications.js';

export async function openDirectusAttachmentFullSlicer(caseId, attachmentId, {
    useSimplifiedViewer,
    seatId
} = {}) {
    const body = {};
    if (useSimplifiedViewer !== undefined) {
        body.useSimplifiedViewer = useSimplifiedViewer === true;
    }
    if (seatId != null && seatId !== '') {
        body.seatId = Number(seatId);
    }

    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/open-local-full-slicer`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body)
        }
    );

    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.openViewerFailed'));
    }
    return data;
}

function attachmentUrl(caseId, attachmentId, suffix) {
    return `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/${suffix}`;
}

/**
 * Save the currently-running Slicer scene back to a case attachment.
 * @param {string} caseId
 * @param {string} attachmentId
 * @param {{ saveMode: 'overwrite' | 'saveAsNew' }} options
 * @returns {Promise<{ success: boolean, saveMode: string, attachment: object }>}
 */
export async function saveDirectusCaseAttachmentScene(caseId, attachmentId, { saveMode = 'overwrite' } = {}) {
    const response = await fetch(attachmentUrl(caseId, attachmentId, 'save-scene'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ saveMode })
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.saveSceneFailed'));
    }
    return data;
}

/** Fetch an attachment's bytes as a Blob for the in-browser SlicerWeb viewer (any case member). */
export async function fetchDirectusAttachmentContent(caseId, attachmentId) {
    const response = await fetch(attachmentUrl(caseId, attachmentId, 'content'), {
        method: 'GET',
        credentials: 'include'
    });
    if (!response.ok) {
        throwApiError(response, await parseJson(response), t('errors.openViewerFailed'));
    }
    return response.blob();
}

export function directusAttachmentDownloadUrl(caseId, attachmentId) {
    return attachmentUrl(caseId, attachmentId, 'download');
}

/**
 * Confirm the save-to-device download will be allowed (role + access) before handing the URL to
 * the browser, so a refusal shows as an error instead of a saved error page. The server also
 * warms its file cache on this request.
 */
export async function checkDirectusAttachmentDownload(caseId, attachmentId) {
    const response = await fetch(directusAttachmentDownloadUrl(caseId, attachmentId), {
        method: 'HEAD',
        credentials: 'include'
    });
    if (!response.ok) {
        const err = new Error(response.status === 403
            ? t('cases.downloadForbidden')
            : t('cases.downloadFailed'));
        err.status = response.status;
        throw err;
    }
}

