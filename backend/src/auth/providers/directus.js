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
import { msg } from '../../i18n/index.js';

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
        throw new AppError(msg('directus.auth_not_configured'), 503, null, 'directus.auth_not_configured');
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
        throw new ValidationError(msg('directus.account_no_email'), null, 'directus.account_no_email');
    }

    const existingLink = findLink(PROVIDER, externalId);
    if (existingLink) {
        const user = User.findById(existingLink.user_id);
        if (!user) {
            throw new ForbiddenError(
                msg('auth.account_link_broken'),
                'ACCOUNT_LINK_BROKEN',
                'auth.account_link_broken'
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
                msg('auth.account_link_conflict'),
                'ACCOUNT_LINK_CONFLICT',
                'auth.account_link_conflict'
            );
        }

        // No product→Directus link yet. After Directus proved this email+password,
        // attach the local product row (provisioned/migrate users). Only refuses if
        // the local user is already linked to a different Directus id (above).
        if (policy === 'email' && !emailLooksVerified(directusUser)) {
            throw new ForbiddenError(
                msg('auth.email_not_verified'),
                'EMAIL_NOT_VERIFIED',
                'auth.email_not_verified'
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
        throw new AppError(msg('directus.profile_load_failed'), 502, null, 'directus.profile_load_failed');
    }

    const directusUser = me.body?.data || me.body;
    const user = await resolveLocalUser(directusUser);
    if (!user) {
        return null;
    }

    // --- CUTOVER (project-case-migrate): deferred collaborator catch-up ---
    try {
        const { applyPendingProjectCaseCollaborators } = await import(
            '../../services/projectCaseMigrate.js'
        );
        await applyPendingProjectCaseCollaborators({
            appUserId: user.id,
            directusUserId: String(directusUser?.id || ''),
            email: user.email || pickDirectusEmail(directusUser)
        });
    } catch (err) {
        console.warn(
            'CUTOVER project-case-migrate: pending collaborator hook failed:',
            err.message || err
        );
    }
    // --- end CUTOVER (project-case-migrate) ---

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
        const email = String(identity || '').trim().toLowerCase();
        if (!email.includes('@')) {
            throw new ValidationError(msg('auth.directus_email_required'), null, 'auth.directus_email_required');
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
                    msg('auth.otp_required'),
                    'OTP_REQUIRED',
                    'auth.otp_required'
                );
            }

            // --- CUTOVER (password-bridge): delete with auth/passwordBridge.js ---
            if (!otp) {
                const { isPasswordBridgeEnabled, tryBridgeLocalPasswordToDirectus } =
                    await import('../passwordBridge.js');
                if (isPasswordBridgeEnabled()) {
                    const bridged = await tryBridgeLocalPasswordToDirectus({
                        email,
                        password
                    });
                    if (bridged) {
                        const retry = await directusJson('/auth/login', {
                            method: 'POST',
                            body: JSON.stringify(payload)
                        });
                        if (retry.res.ok) {
                            const retryData = retry.body?.data || retry.body;
                            const retryAccess = retryData?.access_token;
                            if (retryAccess) {
                                return sessionFromAccessToken(retryAccess, {
                                    refreshToken: retryData?.refresh_token || null,
                                    expires: retryData?.expires
                                });
                            }
                        }
                        if (
                            !otp
                            && looksLikeOtpRequired(retry.body, retry.res.status)
                        ) {
                            throw new UnauthorizedError(
                                msg('auth.otp_required'),
                                'OTP_REQUIRED',
                                'auth.otp_required'
                            );
                        }
                    }
                }
            }
            // --- end CUTOVER (password-bridge) ---

            return null;
        }

        if (!res.ok) {
            const errMsg = body?.errors?.[0]?.message || body?.message || 'Directus login failed';
            if (looksLikeOtpRequired(body, res.status)) {
                throw new UnauthorizedError(msg('auth.otp_required'), 'OTP_REQUIRED', 'auth.otp_required');
            }
            throw new AppError(errMsg, res.status >= 500 ? 502 : res.status);
        }

        const data = body?.data || body;
        const accessToken = data?.access_token;
        if (!accessToken) {
            throw new AppError(msg('directus.login_missing_token'), 502, null, 'directus.login_missing_token');
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
