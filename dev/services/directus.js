import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';

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

export async function uploadDirectusCaseAttachment(caseId, file) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(
        `${API_URL}/api/directus/cases/${encodeURIComponent(caseId)}/attachments`,
        {
            method: 'POST',
            credentials: 'include',
            body: form
        }
    );
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.uploadFileFailed'));
    }
    return data;
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

export async function directusFullSlicerHeartbeat(sessionToken, { seatId } = {}) {
    const body = { sessionToken };
    if (seatId != null && seatId !== '') {
        body.seatId = Number(seatId);
    }
    const response = await fetch(`${API_URL}/api/directus/full-slicer-heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.viewerSessionEnded'));
    }
    return data;
}

export async function stopDirectusFullSlicer(sessionToken, { mode = 'soft', seatId } = {}) {
    const body = { sessionToken, mode };
    if (seatId != null && seatId !== '') {
        body.seatId = Number(seatId);
    }
    const response = await fetch(`${API_URL}/api/directus/full-slicer-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwApiError(response, data, t('errors.stopViewerFailed'));
    }
    return data;
}
