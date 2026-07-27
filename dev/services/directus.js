import { API_URL } from '../config.js';

async function parseJson(response) {
    try {
        return await response.json();
    } catch (_) {
        return {};
    }
}

export async function listDirectusCases({ limit = 50 } = {}) {
    const response = await fetch(`${API_URL}/api/directus/cases?limit=${limit}`, {
        method: 'GET',
        credentials: 'include'
    });

    const data = await parseJson(response);
    if (!response.ok) {
        const message = data.error?.message || data.message || 'Failed to load cases';
        const err = new Error(message);
        err.status = response.status;
        throw err;
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
        const message = data.error?.message || data.message || 'Failed to post comment';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}

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
        const message = data.error?.message || data.message || 'Failed to open Full Slicer';
        const err = new Error(message);
        err.status = response.status;
        throw err;
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
        const message = data.error?.message || data.message || 'Heartbeat failed';
        const err = new Error(message);
        err.status = response.status;
        throw err;
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
        const message = data.error?.message || data.message || 'Failed to stop Full Slicer';
        const err = new Error(message);
        err.status = response.status;
        throw err;
    }

    return data;
}
