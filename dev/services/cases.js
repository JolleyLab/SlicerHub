import { API_URL } from '../config.js';

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
