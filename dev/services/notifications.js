/**
 * Product notifications API (BFF /api/notifications).
 * Generic inbox — not Cases/Directus-specific.
 */

import { API_URL } from '../config.js';

async function parseJson(response) {
    try {
        return await response.json();
    } catch (_) {
        return {};
    }
}

function throwError(response, data, fallback) {
    const err = new Error(data?.error?.message || data?.message || fallback);
    err.status = response.status;
    throw err;
}

export async function listNotifications({ unreadOnly = false } = {}) {
    const q = unreadOnly ? '?unread=1' : '';
    const response = await fetch(`${API_URL}/api/notifications${q}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwError(response, data, "Couldn't load notifications.");
    }
    return data;
}

export async function markNotificationRead(id) {
    const response = await fetch(`${API_URL}/api/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwError(response, data, "Couldn't update notification.");
    }
    return data;
}

export async function markAllNotificationsRead() {
    const response = await fetch(`${API_URL}/api/notifications/read-all`, {
        method: 'POST',
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwError(response, data, "Couldn't update notifications.");
    }
    return data;
}

/** Tell any open notification-bell to refetch. */
export function invalidateNotifications() {
    window.dispatchEvent(new CustomEvent('notifications-invalidate'));
}
