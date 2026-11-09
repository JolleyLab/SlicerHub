// Registration review (approval gate): reviewers' queue of accounts waiting for access.
import { API_URL } from '../config.js';
import { readJson, apiError } from './apiResponse.js';

export async function listPendingRegistrations() {
    const response = await fetch(`${API_URL}/api/admin/registration-requests`, { credentials: 'include' });
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, 'Failed to load registration requests', { friendly: true });
    return data.data || [];
}

export async function getPendingRegistrationsCount() {
    const response = await fetch(`${API_URL}/api/admin/registration-requests/count`, { credentials: 'include', cache: 'no-store' });
    const data = await readJson(response);
    if (!response.ok) return 0;
    return Number(data.count) || 0;
}

export async function approveRegistration(id, { asAdmin = false } = {}) {
    const response = await fetch(`${API_URL}/api/admin/registration-requests/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asAdmin })
    });
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, 'Failed to approve registration', { friendly: true });
    return data;
}

export async function rejectRegistration(id) {
    const response = await fetch(`${API_URL}/api/admin/registration-requests/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        credentials: 'include'
    });
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, 'Failed to reject registration', { friendly: true });
    return data;
}
