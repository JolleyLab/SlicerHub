/**
 * Directus password login via BFF.
 *
 * Responsible only for: credential check + return local product user.
 * Product session and cookies are owned by auth/session.js.
 * MFA (OTP) is enforced by Directus; the BFF surfaces OTP_REQUIRED to the SPA.
 */

import config from '../../config/index.js';
import User from '../../models/User.js';
import { UnauthorizedError, ValidationError, ForbiddenError, AppError } from '../../utils/errors.js';
import {
    findLink,
    findDirectusLinkForUser,
    linkIdentity,
    storeProviderTokens
} from '../identityStore.js';

const PROVIDER = 'directus';

function directusBaseUrl() {
    return (config.directus.url || '').trim().replace(/\/+$/, '');
}

function linkPolicy() {
    const raw = String(config.auth?.linkPolicy || 'strict').toLowerCase();
    return raw === 'email' ? 'email' : 'strict';
}

async function directusJson(path, options = {}) {
    const base = directusBaseUrl();
    if (!base) {
        throw new AppError('Directus auth is not configured (DIRECTUS_URL)', 503);
    }

    const res = await fetch(`${base}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {})
        }
    });

    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    return { res, body };
}

function pickDirectusEmail(userInfo) {
    return String(userInfo?.email || '').trim().toLowerCase();
}

function pickDirectusUsername(userInfo, email) {
    const fromProvider = String(userInfo?.username || '').trim();
    if (fromProvider) return fromProvider;
    const local = email.split('@')[0] || 'user';
    return local.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'user';
}

function emailLooksVerified(directusUser) {
    if (directusUser?.email_verified === false) return false;
    if (directusUser?.status && String(directusUser.status).toLowerCase() === 'draft') return false;
    return true;
}

function looksLikeOtpRequired(body, status) {
    const msg = body?.errors?.[0]?.message || body?.message || '';
    const lower = String(msg).toLowerCase();
    const code = body?.errors?.[0]?.extensions?.code;
    if (code === 'INVALID_OTP') return true;
    if (!/otp|totp|two.?factor|2fa|one.?time/.test(lower)) return false;
    if (status === 401 || status === 400) return true;
    return /required|enter|missing|provide|otp|totp|2fa/.test(lower);
}

async function resolveLocalUser(directusUser) {
    const externalId = String(directusUser?.id || '').trim();
    if (!externalId) {
        throw new AppError('Directus user id missing from /users/me', 502);
    }

    const email = pickDirectusEmail(directusUser);
    if (!email) {
        throw new ValidationError('Directus account has no email; cannot map to application user');
    }

    const existingLink = findLink(PROVIDER, externalId);
    if (existingLink) {
        const user = User.findById(existingLink.user_id);
        if (!user) {
            throw new ForbiddenError(
                'Linked product account is missing. Contact an administrator.',
                'ACCOUNT_LINK_BROKEN'
            );
        }
        if (user.is_active === 0 || user.is_active === false) {
            return null;
        }
        User.touchLastLogin(user.id);
        return user;
    }

    const emailOwner = User.findByEmail(email);
    const policy = linkPolicy();

    if (emailOwner) {
        const ownerLink = findDirectusLinkForUser(emailOwner.id);
        if (ownerLink) {
            if (String(ownerLink.external_id) === externalId) {
                // Link exists but findLink missed (shouldn't); recover path
                User.touchLastLogin(emailOwner.id);
                return User.findById(emailOwner.id);
            }
            throw new ForbiddenError(
                'This email is already linked to a different Directus account. Contact an administrator.',
                'ACCOUNT_LINK_CONFLICT'
            );
        }

        // No product→Directus link yet. After Directus proved this email+password,
        // attach the local product row (provisioned/migrate users). Only refuses if
        // the local user is already linked to a different Directus id (above).
        if (policy === 'email' && !emailLooksVerified(directusUser)) {
            throw new ForbiddenError(
                'Email must be verified before this account can be linked.',
                'EMAIL_NOT_VERIFIED'
            );
        }
        linkIdentity(emailOwner.id, PROVIDER, externalId);
        // Pattern A / migration: first Directus attach for an existing product user
        // should force a personal password (temp may still be the shared one).
        User.setMustChangePassword(emailOwner.id, true);
        User.touchLastLogin(emailOwner.id);
        return User.findById(emailOwner.id);
    }

    const user = await User.createExternalShadow({
        email,
        username: pickDirectusUsername(directusUser, email)
    });
    linkIdentity(user.id, PROVIDER, externalId);
    return User.findById(user.id);
}

async function sessionFromAccessToken(accessToken, extraTokens = {}) {
    const me = await directusJson('/users/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!me.res.ok) {
        throw new AppError('Failed to load Directus user profile', 502);
    }

    const directusUser = me.body?.data || me.body;
    const user = await resolveLocalUser(directusUser);
    if (!user) {
        return null;
    }

    return {
        user,
        externalTokens: {
            accessToken,
            refreshToken: extraTokens.refreshToken || extraTokens.refresh_token || null,
            expires: extraTokens.expires
        }
    };
}

export const directusProvider = {
    name: PROVIDER,

    /**
     * @param {{ identity: string, password: string, otp?: string }} credentials
     */
    async login({ identity, password, otp }) {
        const email = String(identity || '').trim();
        if (!email.includes('@')) {
            throw new ValidationError('Email is required when using Directus login');
        }

        const payload = {
            email,
            password,
            mode: 'json'
        };
        if (otp) {
            payload.otp = otp;
        }

        const { res, body } = await directusJson('/auth/login', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.status === 401 || res.status === 400) {
            if (!otp && looksLikeOtpRequired(body, res.status)) {
                throw new UnauthorizedError(
                    'Additional verification required',
                    'OTP_REQUIRED'
                );
            }
            return null;
        }

        if (!res.ok) {
            const msg = body?.errors?.[0]?.message || body?.message || 'Directus login failed';
            if (looksLikeOtpRequired(body, res.status)) {
                throw new UnauthorizedError('Additional verification required', 'OTP_REQUIRED');
            }
            throw new AppError(msg, res.status >= 500 ? 502 : res.status);
        }

        const data = body?.data || body;
        const accessToken = data?.access_token;
        if (!accessToken) {
            throw new AppError('Directus login response missing access_token', 502);
        }

        return sessionFromAccessToken(accessToken, {
            refreshToken: data?.refresh_token || null,
            expires: data?.expires
        });
    },

    storeSessionTokens(tokenJti, userId, externalTokens) {
        storeProviderTokens(tokenJti, userId, PROVIDER, externalTokens);
    }
};
