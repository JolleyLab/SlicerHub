import { API_URL } from '../config.js';
import { tusUpload } from './tusUpload.js';
import { t } from '../i18n/index.js';
import { parseApiResponse, apiError, readJson } from './apiResponse.js';

// Kept here too: callers have always imported the error wording from the cases service.
export { friendlyCasesError } from './apiResponse.js';

const parseResponse = (res) => parseApiResponse(res);

export async function listCases({ limit = 50 } = {}) {
    const res = await fetch(`${API_URL}/api/cases?limit=${limit}`, {
        credentials: 'include',
        cache: 'no-store',
    });
    return parseResponse(res);
}

/**
 * Can the signed-in user still open this case? 'ok', 'lost' (403/404: removed from the
 * case or a group that had it, or the case was deleted) or 'unknown' (offline, signed out…).
 */
export async function getCaseAccess(caseId) {
    try {
        const res = await fetch(`${API_URL}/api/cases/${encodeURIComponent(caseId)}`, {
            credentials: 'include',
            cache: 'no-store',
        });
        if (res.ok) return 'ok';
        if (res.status === 403 || res.status === 404) return 'lost';
        return 'unknown';
    } catch {
        return 'unknown';
    }
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
 * Propose a SlicerHub group as a case collaborator.
 * Admins are linked immediately; collaborators are queued for admin approval.
 * Returns { status: 'added'|'pending_approval', group: { id, name } }
 */
export async function proposeGroupCollaborator(caseId, { groupId, role = 'collaborator' } = {}) {
    const res = await fetch(
        `${API_URL}/api/cases/${encodeURIComponent(caseId)}/group-invites`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ groupId, role }),
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
 * Returns { status, emailSent?, collaborator? }
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
/** Invites across all cases that the signed-in user can approve or reject. */
export async function listInvitesAwaitingMyApproval() {
    const response = await fetch(`${API_URL}/api/cases/invites/pending-approval`, { credentials: 'include', cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, t('errors.loadInvitesFailed'), { friendly: true });
    return data.invites || [];
}

/** Recent invite activity (sent, approved) on the user's cases, newest first. */
export async function listRecentActivity() {
    const response = await fetch(`${API_URL}/api/cases/activity/recent`, { credentials: 'include', cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, t('errors.loadActivityFailed'), { friendly: true });
    return data.events || [];
}

let activeUploads = 0;

/** True while any case upload is still sending (sign-out asks first: it would be lost). */
export function hasActiveUploads() {
    return activeUploads > 0;
}

export async function uploadCaseAttachment(caseId, file, { signal, onProgress } = {}) {
    const endpoint = `${API_URL}/api/cases/${encodeURIComponent(caseId)}/files/tus`;
    activeUploads += 1;
    try {
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
    } finally {
        activeUploads -= 1;
    }
}

/**
 * Save a SlicerWeb scene as a case attachment.
 * Uploads the file, finds the new attachment record, and deletes the old one for overwrite mode.
 * Returns { attachment } with the raw Payload attachment object.
 */
export async function savePayloadSlicerWebScene(caseId, attachmentId, file, { saveMode = 'overwrite', name, signal, onProgress } = {}) {
    const uploadFile = name ? new File([file], name, { type: file.type }) : file;
    const startedAt = Date.now();
    await uploadCaseAttachment(caseId, uploadFile, { signal, onProgress });

    // Find the attachment this upload created: same name, created since the save began.
    // (Not just "the newest one": if the server failed to record the upload, the newest
    // would be some other file — and overwrite mode would then delete the original.)
    const data = await listAttachments(caseId);
    const newAtt = [...(data.attachments || [])]
        .filter((a) => String(a.original_filename || '') === uploadFile.name
            && (Date.parse(a.createdAt || '') || 0) >= startedAt - 60 * 1000
            && String(a.id) !== String(attachmentId))
        .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))[0] || null;

    if (!newAtt) {
        // Nothing to show for it: report the failure and keep the original untouched.
        throw new Error(t('errors.saveSceneFailed'));
    }

    if (saveMode === 'overwrite' && attachmentId) {
        await deleteAttachment(caseId, attachmentId).catch(() => {});
    }

    return { attachment: newAtt };
}
