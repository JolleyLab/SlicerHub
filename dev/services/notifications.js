/**
 * Product notifications API (BFF /api/notifications).
 * Generic inbox — not Cases/Directus-specific.
 */

import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';

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
        throwError(response, data, t('notifications.loadFailed'));
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
        throwError(response, data, t('notifications.updateFailed'));
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
        throwError(response, data, t('notifications.markAllFailed'));
    }
    return data;
}

/** Remove from inbox; does not cancel pending invites. */
export async function dismissNotification(id) {
    const response = await fetch(`${API_URL}/api/notifications/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
    });
    const data = await parseJson(response);
    if (!response.ok) {
        throwError(response, data, t('notifications.dismissFailed'));
    }
    return data;
}

/** Tell any open notification-bell to refetch. */
export function invalidateNotifications() {
    window.dispatchEvent(new CustomEvent('notifications-invalidate'));
}
