/**
 * ============================================================================
 * CUTOVER — SQLite → Directus password bridge (one release window)
 * ============================================================================
 * Delete this file and all `CUTOVER (password-bridge)` call sites when the
 * migration window ends:
 *   - backend/src/auth/passwordBridge.js  (this file)
 *   - config.auth.passwordBridge + AUTH_PASSWORD_BRIDGE
 *   - startup warn in config/index.js
 *   - tryPasswordBridgeAfterDirectusFailure in providers/directus.js
 *   - User.hasLocalPasswordHash / clearLocalPasswordHash
 *   - docs / .env.example notes for AUTH_PASSWORD_BRIDGE
 *
 * Behavior: With AUTH_PASSWORD_BRIDGE=true and AUTH_PROVIDER=directus, if
 * Directus login fails, verify email+password against SQLite. Then ensure a
 * Directus user + identity link exist (create if migrate was skipped), set
 * that password on Directus, and let the caller retry login. Local hash is
 * cleared only after a successful Directus retry (caller passes clearLocalHash
 * or clears itself).
 * ============================================================================
 */

import config from '../config/index.js';
import User from '../models/User.js';
import { findDirectusLinkForUser, linkIdentity } from './identityStore.js';
import {
    findDirectusUserByEmail,
    createDirectusUser,
    updateDirectusUser
} from '../services/directus.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const PROVIDER = 'directus';

export function isPasswordBridgeEnabled() {
    return config.auth?.passwordBridge === true;
}

/**
 * @param {{ email: string, password: string, clearLocalHash?: boolean }} args
 * @returns {Promise<boolean>} true if Directus is ready for retry login
 */
export async function tryBridgeLocalPasswordToDirectus({
    email,
    password,
    clearLocalHash = false
}) {
    if (!isPasswordBridgeEnabled()) {
        console.info('CUTOVER password-bridge: skipped (AUTH_PASSWORD_BRIDGE not true)');
        return false;
    }

    const identity = String(email || '').trim().toLowerCase();
    const pass = String(password || '');
    if (!identity.includes('@') || !pass) {
        console.info('CUTOVER password-bridge: skipped (need email + password)');
        return false;
    }

    if (pass.length < 8) {
        throw new ValidationError(
            msg('auth.password_min_length_short', { min: 8 }),
            null,
            'auth.password_min_length_short'
        );
    }

    const localUser = User.findByEmail(identity);
    if (!localUser || localUser.is_active === 0 || localUser.is_active === false) {
        console.info('CUTOVER password-bridge: no active local user for', identity);
        return false;
    }

    if (!User.hasLocalPasswordHash(localUser.id)) {
        console.info('CUTOVER password-bridge: local hash already bridged/cleared for', identity);
        return false;
    }

    const verified = await User.verifyPassword(identity, pass);
    if (!verified || Number(verified.id) !== Number(localUser.id)) {
        console.info('CUTOVER password-bridge: local password did not match for', identity);
        return false;
    }

    const roleId = String(config.directus?.defaultRoleId || '').trim();
    if (!roleId) {
        console.error('CUTOVER password-bridge: DIRECTUS_DEFAULT_ROLE_ID is required to provision');
        throw new AppError(
            msg('admin.provision_role_required'),
            502,
            null,
            'admin.provision_role_required'
        );
    }

    let link = findDirectusLinkForUser(localUser.id);
    let directusUserId = link?.external_id ? String(link.external_id) : null;
    let createdDirectus = false;

    if (!directusUserId) {
        try {
            const existing = await findDirectusUserByEmail(identity);
            if (existing?.id) {
                directusUserId = String(existing.id);
                console.info(
                    'CUTOVER password-bridge: found existing Directus user for',
                    identity,
                    directusUserId
                );
            }
        } catch (err) {
            console.warn(
                'CUTOVER password-bridge: Directus email lookup failed',
                identity,
                err.message || err
            );
        }
    }

    if (!directusUserId) {
        try {
            const created = await createDirectusUser({
                email: identity,
                password: pass,
                roleId,
                firstName: localUser.firstName || localUser.first_name || undefined,
                lastName: localUser.lastName || localUser.last_name || undefined
            });
            directusUserId = String(created.id);
            createdDirectus = true;
            console.info(
                'CUTOVER password-bridge: created Directus user for',
                identity,
                directusUserId
            );
        } catch (err) {
            console.error(
                'CUTOVER password-bridge: failed to create Directus user for',
                identity,
                err.message || err
            );
            throw new AppError(
                msg('auth.password_bridge_failed'),
                502,
                null,
                'auth.password_bridge_failed'
            );
        }
    }

    if (!findDirectusLinkForUser(localUser.id)?.external_id) {
        linkIdentity(localUser.id, PROVIDER, directusUserId);
        console.info(
            'CUTOVER password-bridge: linked local user',
            localUser.id,
            '→',
            directusUserId
        );
    }

    // Newly created users already have this password; existing ones need a PATCH.
    if (!createdDirectus) {
        try {
            await updateDirectusUser(directusUserId, { password: pass });
        } catch (err) {
            console.error(
                'CUTOVER password-bridge: failed to set Directus password for',
                identity,
                err.message || err
            );
            throw new AppError(
                msg('auth.password_bridge_failed'),
                502,
                null,
                'auth.password_bridge_failed'
            );
        }
    }

    if (clearLocalHash) {
        try {
            await User.clearLocalPasswordHash(localUser.id);
        } catch (err) {
            console.warn(
                'CUTOVER password-bridge: Directus password set but local hash clear failed:',
                err.message || err
            );
        }
    }

    console.info(`CUTOVER password-bridge: ready for Directus retry for ${identity}`);
    return true;
}
