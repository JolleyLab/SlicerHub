import config from '../config/index.js';
import User from '../models/User.js';
import { findDirectusLinkForUser, findLinkForUser } from './identityStore.js';
import { isDirectusConfigured, updateDirectusUser } from '../services/directus.js';
import { ValidationError, UnauthorizedError, AppError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const minLen = () => config.security?.passwordMinLength || 8;

// ---------------------------------------------------------------------------
// Directus path (unchanged)
// ---------------------------------------------------------------------------

async function loginDirectusForTokens(email, password) {
    const base = (config.directus.url || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new AppError(msg('directus.not_configured'), 503, null, 'directus.not_configured');
    }

    const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            email: String(email || '').trim().toLowerCase(),
            password: String(password || ''),
            mode: 'json'
        })
    });

    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) return null;

    const data = body?.data || body;
    const accessToken = data?.access_token;
    if (!accessToken) return null;
    return { accessToken, refreshToken: data?.refresh_token || null, expires: data?.expires };
}

// ---------------------------------------------------------------------------
// Keycloak path
// ---------------------------------------------------------------------------

async function getKeycloakAdminToken() {
    const { url, adminUser, adminPassword } = config.keycloak;
    if (!url) throw new AppError('Keycloak is not configured (KEYCLOAK_URL missing)', 503);

    const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'password',
            client_id:  'admin-cli',
            username:   adminUser,
            password:   adminPassword
        })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak admin login failed (${res.status}): ${text}`, 502);
    }
    return (await res.json()).access_token;
}

async function verifyKeycloakPassword(email, password) {
    const { url, realm, clientId, clientSecret } = config.keycloak;
    const res = await fetch(`${url}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type:    'password',
            client_id:     clientId,
            client_secret: clientSecret,
            username:      email,
            password,
            scope:         'openid'
        })
    });

    if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* non-JSON */ }
        if (body?.error === 'invalid_grant') return false;
        throw new AppError(`Keycloak error during password verify (${res.status})`, 502);
    }
    return true;
}

async function changePasswordKeycloak({ userId, user, currentPassword, newPassword }) {
    const link = findLinkForUser(userId, 'keycloak');
    if (!link) {
        throw new AppError('No Keycloak identity linked to this account', 400);
    }

    const verified = await verifyKeycloakPassword(user.email, currentPassword);
    if (!verified) {
        throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
    }

    const adminToken = await getKeycloakAdminToken();
    const { url, realm } = config.keycloak;

    const res = await fetch(
        `${url}/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(link.external_id)}/reset-password`,
        {
            method: 'PUT',
            headers: {
                Authorization:  `Bearer ${adminToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type: 'password', value: newPassword, temporary: false })
        }
    );

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak password reset failed (${res.status}): ${text}`, 502);
    }

    User.clearMustChangePassword(userId);
    return { ...User.findById(userId), mustChangePassword: false };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * @param {{ userId: number, currentPassword: string, newPassword: string, firstName?: string, lastName?: string }} input
 */
export async function changePasswordForUser({
    userId,
    currentPassword,
    newPassword,
    firstName,
    lastName
}) {
    const user = User.findById(userId);
    if (!user) throw new ValidationError(msg('user.not_found'), null, 'user.not_found');

    const next = String(newPassword || '');
    const current = String(currentPassword || '');

    if (next.length < minLen()) {
        throw new ValidationError(msg('auth.password_min_length_short', { min: minLen() }), null, 'auth.password_min_length_short');
    }
    if (!current) {
        throw new ValidationError(msg('auth.current_password_required'), null, 'auth.current_password_required');
    }
    if (next === current) {
        throw new ValidationError(msg('auth.password_must_differ'), null, 'auth.password_must_differ');
    }

    // Keycloak path
    if (config.auth.provider === 'keycloak') {
        return changePasswordKeycloak({ userId, user, currentPassword: current, newPassword: next });
    }

    // Directus path
    const link = findDirectusLinkForUser(userId);
    if (link && isDirectusConfigured()) {
        const first = String(firstName || '').trim();
        const last  = String(lastName  || '').trim();
        if (!first) throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
        if (!last)  throw new ValidationError(msg('auth.last_name_required'),  null, 'auth.last_name_required');

        const verified = await loginDirectusForTokens(user.email, current);
        if (!verified?.accessToken) {
            throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
        }

        await updateDirectusUser(link.external_id, { password: next, firstName: first, lastName: last });
        User.clearMustChangePassword(userId);

        const directusTokens = await loginDirectusForTokens(user.email, next);
        if (!directusTokens?.accessToken) {
            throw new AppError(
                msg('directus.session_refresh_after_password_failed'), 502, null,
                'directus.session_refresh_after_password_failed'
            );
        }

        return { ...User.findById(userId), firstName: first, lastName: last, mustChangePassword: false, directusTokens };
    }

    throw new AppError(msg('auth.password_change_not_allowed'), 400, null, 'auth.password_change_not_allowed');
}
