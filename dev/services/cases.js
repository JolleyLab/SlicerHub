import { API_URL } from '../config.js';
import { tusUpload } from './tusUpload.js';

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
