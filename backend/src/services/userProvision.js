/**
 * Admin bulk user provision (Pattern A: temporary password).
 * Creates Directus users via service token, local shadow users, and identity links.
 * Pattern B (invite_email) is stubbed until mail delivery is wired — see
 * docs/user-provisioning-patterns.md (gitignored handoff).
 */

import crypto from 'crypto';
import config from '../config/index.js';
import User from '../models/User.js';
import { linkIdentity, findLink, findDirectusLinkForUser } from '../auth/identityStore.js';
import {
    isDirectusConfigured,
    findDirectusUserByEmail,
    createDirectusUser,
    DirectusUnavailableError
} from './directus.js';
import { ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const PROVIDER = 'directus';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveMode(requestMethod) {
    const requested = String(requestMethod || config.userProvision?.mode || 'temp_password')
        .trim()
        .toLowerCase();
    if (requested === 'invite_email') return 'invite_email';
    if (requested === 'temp_password') return 'temp_password';
    throw new ValidationError(
        msg('admin.provision_unknown_method', { method: requested }),
        null,
        'admin.provision_unknown_method'
    );
}

function generateTemporaryPassword() {
    // ~18 chars url-safe; meets typical hospital password length policies in practice
    return crypto.randomBytes(14).toString('base64url');
}

function passwordForUser(sharedFromRequest) {
    const shared = String(sharedFromRequest || '').trim()
        || String(config.userProvision?.defaultTemporaryPassword || '').trim();
    if (shared) {
        if (shared.length < 8) {
            throw new ValidationError(msg('admin.provision_password_too_short'), null, 'admin.provision_password_too_short');
        }
        return { password: shared, generated: false };
    }
    return { password: generateTemporaryPassword(), generated: true };
}

/**
 * @param {{ email: string, firstName?: string, lastName?: string, username?: string }} item
 * @param {{ method?: string, temporaryPassword?: string }} options
 */
export async function provisionOneUser(item, options = {}) {
    const mode = resolveMode(options.method);
    if (mode === 'invite_email') {
        return {
            email: String(item?.email || '').trim().toLowerCase(),
            status: 'not_implemented',
            error:
                'invite_email (Pattern B) is not implemented yet. '
                + 'Set USER_PROVISION_MODE=temp_password or method: temp_password. '
                + 'See docs/user-provisioning-patterns.md for the handoff.'
        };
    }

    if (!isDirectusConfigured()) {
        throw new DirectusUnavailableError(msg('admin.provision_directus_required'));
    }

    const roleId = String(config.directus.defaultRoleId || '').trim();
    if (!roleId) {
        throw new ValidationError(msg('admin.provision_role_required'), null, 'admin.provision_role_required');
    }

    const email = String(item?.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
        return { email: email || null, status: 'error', error: 'Invalid email' };
    }

    let passwordInfo;
    try {
        passwordInfo = passwordForUser(options.temporaryPassword);
    } catch (err) {
        return { email, status: 'error', error: err.message || 'Invalid temporary password' };
    }

    try {
        let directusUser = await findDirectusUserByEmail(email);
        let createdDirectus = false;

        if (!directusUser) {
            directusUser = await createDirectusUser({
                email,
                password: passwordInfo.password,
                roleId,
                firstName: item.firstName,
                lastName: item.lastName
            });
            createdDirectus = true;
        }

        const directusUserId = String(directusUser.id);
        const existingLink = findLink(PROVIDER, directusUserId);
        if (existingLink) {
            const local = User.findById(existingLink.user_id);
            if (local) {
                User.setMustChangePassword(local.id, true);
                return {
                    email,
                    status: 'already_linked',
                    userId: local.id,
                    directusUserId,
                    mustChangePassword: true,
                    // Do not re-emit password for existing Directus accounts we did not create
                    temporaryPassword: createdDirectus ? passwordInfo.password : undefined,
                    note: createdDirectus
                        ? undefined
                        : 'Directus user already existed; password left unchanged. Flag set to must_change_password.'
                };
            }
        }

        let localUser = User.findByEmail(email);
        if (localUser) {
            const other = findDirectusLinkForUser(localUser.id);
            if (other && String(other.external_id) !== directusUserId) {
                return {
                    email,
                    status: 'error',
                    error: `Local user is already linked to a different Directus id (${other.external_id})`,
                    userId: localUser.id
                };
            }
        } else {
            localUser = await User.createExternalShadow({
                email,
                username: item.username || (item.firstName
                    ? `${item.firstName}.${item.lastName || 'user'}`.toLowerCase().replace(/\s+/g, '')
                    : undefined)
            });
        }

        linkIdentity(localUser.id, PROVIDER, directusUserId);
        User.setMustChangePassword(localUser.id, true);

        return {
            email,
            status: createdDirectus ? 'created' : 'linked_existing_directus',
            userId: localUser.id,
            directusUserId,
            mustChangePassword: true,
            temporaryPassword: createdDirectus ? passwordInfo.password : undefined,
            note: createdDirectus
                ? undefined
                : 'Directus user already existed; password not reset. User can login if they know existing password, then must change.'
        };
    } catch (err) {
        return {
            email,
            status: 'error',
            error: err.message || String(err)
        };
    }
}

/**
 * @param {{ users: Array<{ email: string, firstName?: string, lastName?: string }>, method?: string, temporaryPassword?: string }} body
 */
export async function provisionUsersBulk(body = {}) {
    const raw = Array.isArray(body.users) ? body.users : null;
    if (!raw || raw.length === 0) {
        throw new ValidationError(msg('admin.provision_users_required'), null, 'admin.provision_users_required');
    }
    if (raw.length > 200) {
        throw new ValidationError(msg('admin.provision_batch_limit'), null, 'admin.provision_batch_limit');
    }

    const method = body.method;
    const temporaryPassword = body.temporaryPassword;
    const results = [];
    for (const item of raw) {
        // Sequential: avoids flooding Directus and simplifies rate limits
        // eslint-disable-next-line no-await-in-loop
        results.push(await provisionOneUser(item, { method, temporaryPassword }));
    }

    const summary = {
        total: results.length,
        created: results.filter((r) => r.status === 'created').length,
        linkedExisting: results.filter((r) => r.status === 'linked_existing_directus' || r.status === 'already_linked').length,
        errors: results.filter((r) => r.status === 'error' || r.status === 'not_implemented').length
    };

    return { method: resolveMode(method), summary, results };
}
