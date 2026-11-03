import config from '../config/index.js';
import User from '../models/User.js';
import { findLinkForUser } from './identityStore.js';
import { ValidationError, UnauthorizedError, AppError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const minLen = () => config.security?.passwordMinLength || 8;

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

    return changePasswordKeycloak({ userId, user, currentPassword: current, newPassword: next });
}
