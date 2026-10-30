import { API_URL } from '../config.js';
import { tusUpload } from './tusUpload.js';
import { t } from '../i18n/index.js';

/**
 * Map API errors to short user-facing copy.
 */
export function friendlyCasesError(raw, fallback = 'Something went wrong. Please try again.', status = 0, code = null) {
    const text = String(raw || '').trim();
    const lower = text.toLowerCase();

    if (
        /sign in once with your email and password|account connection expired|connect to your account/i.test(lower)
    ) {
        return text;
    }

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

export { friendlyCasesError as friendlyError };

async function parseResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.error?.message || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return data;
}

export async function listCases({ limit = 50 } = {}) {
    const res = await fetch(`${API_URL}/api/cases?limit=${limit}`, {
        credentials: 'include',
        cache: 'no-store',
    });
    return parseResponse(res);
}

export async function createCase({ title, description, status } = {}) {
    const res = await fetch(`${API_URL}/api/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, description, status }),
    });
    return parseResponse(res);
}

export async function updateCase(id, updates = {}) {
    const res = await fetch(`${API_URL}/api/cases/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
    });
    return parseResponse(res);
}

export async function deleteCase(id) {
    const res = await fetch(`${API_URL}/api/cases/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (res.status === 204) return { ok: true };
    return parseResponse(res);
}

export async function listAttachments(caseId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/attachments`,
        { credentials: 'include', cache: 'no-store' }
    );
    return parseResponse(res);
}

export async function deleteAttachment(caseId, attachmentId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE', credentials: 'include' }
    );
    if (res.status === 204) return { ok: true };
    return parseResponse(res);
}

export async function fetchPayloadAttachmentContent(caseId, attachmentId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { credentials: 'include' }
    );
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data?.error?.message || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
    }
    return res.blob();
}

export async function openPayloadAttachmentFullSlicer(caseId, attachmentId, { useSimplifiedViewer, seatId } = {}) {
    const body = {};
    if (useSimplifiedViewer !== undefined) body.useSimplifiedViewer = useSimplifiedViewer === true;
    if (seatId != null && seatId !== '') body.seatId = Number(seatId);

    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/open-local-full-slicer`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        }
    );
    return parseResponse(res);
}

// ── Collaborator management ────────────────────────────────────────────────

/**
 * Look up a Keycloak account by email address.
 * Returns { user: { id, email, firstName, lastName } } or throws 404.
 */
export async function lookupCaseUser(email) {
    const res = await fetch(
        `${API_URL}/api/cases/lookup-user?email=${encodeURIComponent(email)}`,
        { credentials: 'include' }
    );
    return parseResponse(res);
}

/**
 * List collaborators on a case.
 * Returns { collaborators: [{ id, email, firstName, lastName, role }] }
 */
export async function listCollaborators(caseId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/collaborators`,
        { credentials: 'include', cache: 'no-store' }
    );
    return parseResponse(res);
}

/**
 * Invite a user to a case by email.
 * Returns { collaborator: { id, email, firstName, lastName, role } }
 */
export async function inviteCollaborator(caseId, { email, role = 'collaborator' } = {}) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/invites`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, role }),
        }
    );
    return parseResponse(res);
}

/**
 * Bulk-replace collaborators on a case (People dialog Save).
 * collaborators: [{ id: keycloakUserId, role }]
 */
export async function updateCollaborators(caseId, collaborators) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/collaborators`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ collaborators }),
        }
    );
    return parseResponse(res);
}

/**
 * Remove a single collaborator from a case.
 */
export async function removeCollaborator(caseId, keycloakUserId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/collaborators/${encodeURIComponent(keycloakUserId)}`,
        { method: 'DELETE', credentials: 'include' }
    );
    if (res.status === 204) return { ok: true };
    return parseResponse(res);
}

/**
 * List pending invites for a case.
 * Returns { invites: [{ id, kind, status, inviteeEmail, proposedRole }] }
 */
export async function getPendingCaseInvitesCount() {
    try {
        const res = await fetch(
            `${API_URL}/api/cases/invites/pending-count`,
            { credentials: 'include', cache: 'no-store' }
        );
        if (!res.ok) return 0;
        const data = await res.json();
        return Number(data.count) || 0;
    } catch {
        return 0;
    }
}

export async function listCaseInvites(caseId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/invites`,
        { credentials: 'include', cache: 'no-store' }
    );
    return parseResponse(res);
}

/**
 * Approve a pending invite (admin only).
 * Returns { status, emailSent?, inviteUrl?, collaborator? }
 */
export async function approveCaseInvite(caseId, inviteId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/invites/${encodeURIComponent(inviteId)}/approve`,
        { method: 'POST', credentials: 'include' }
    );
    return parseResponse(res);
}

/**
 * Reject a pending invite (admin only).
 */
export async function rejectCaseInvite(caseId, inviteId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/invites/${encodeURIComponent(inviteId)}/reject`,
        { method: 'POST', credentials: 'include' }
    );
    return parseResponse(res);
}

/**
 * Preview a Keycloak case signup invite by token (no auth required).
 * Returns { email, caseTitle, caseId, role, expiresAt }
 */
export async function previewKcInvite(token) {
    const res = await fetch(
        `${API_URL}/api/cases/invites/preview?token=${encodeURIComponent(token)}`
    );
    return parseResponse(res);
}

/**
 * Redeem a Keycloak case signup invite: set name + password, enable account.
 * Returns { status: 'accepted', email, caseId }
 */
export async function redeemKcInvite(token, { firstName, lastName, password } = {}) {
    const res = await fetch(`${API_URL}/api/cases/invites/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, firstName, lastName, password }),
    });
    return parseResponse(res);
}

// ── Comments ───────────────────────────────────────────────────────────────

export async function listComments(caseId) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/comments`,
        { credentials: 'include', cache: 'no-store' }
    );
    return parseResponse(res);
}

export async function createComment(caseId, text) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/comments`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ text }),
        }
    );
    return parseResponse(res);
}

export { approveCaseInvite as approveInvite, rejectCaseInvite as rejectInvite };
export { listInvitesAwaitingMyApproval, listRecentActivity } from './directus.js';

export async function uploadCaseAttachment(caseId, file, { signal, onProgress } = {}) {
    const endpoint = `${API_URL}/api/cases/${encodeURIComponent(caseId)}/files/tus`;
    await tusUpload({
        file,
        endpoint,
        metadata: {
            filename: file.name,
            filetype: file.type || 'application/octet-stream',
        },
        signal,
        onProgress,
    });
}

/**
 * Save a SlicerWeb scene as a case attachment.
 * Uploads the file, finds the new attachment record, and deletes the old one for overwrite mode.
 * Returns { attachment } with the raw Payload attachment object.
 */
export async function savePayloadSlicerWebScene(caseId, attachmentId, file, { saveMode = 'overwrite', name, signal, onProgress } = {}) {
    const uploadFile = name ? new File([file], name, { type: file.type }) : file;
    await uploadCaseAttachment(caseId, uploadFile, { signal, onProgress });

    const data = await listAttachments(caseId);
    const sorted = [...(data.attachments || [])].sort((a, b) => {
        const ta = Date.parse(a.createdAt || '') || 0;
        const tb = Date.parse(b.createdAt || '') || 0;
        return tb - ta;
    });
    const newAtt = sorted[0] || null;

    if (saveMode === 'overwrite' && attachmentId && newAtt?.id !== attachmentId) {
        await deleteAttachment(caseId, attachmentId).catch(() => {});
    }

    return { attachment: newAtt };
}
