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
 * Behavior: after migrate-local-users-to-directus, Directus users exist with a
 * random password. With AUTH_PASSWORD_BRIDGE=true and AUTH_PROVIDER=directus,
 * if Directus login fails with bad credentials, verify the same email+password
 * against SQLite bcrypt, PATCH that password onto the linked Directus user,
 * invalidate the local hash, then retry Directus login.
 * ============================================================================
 */

import config from '../config/index.js';
import User from '../models/User.js';
import { findDirectusLinkForUser, linkIdentity } from './identityStore.js';
import { findDirectusUserByEmail, updateDirectusUser } from '../services/directus.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const PROVIDER = 'directus';

export function isPasswordBridgeEnabled() {
    return config.auth?.passwordBridge === true;
}

/**
 * @param {{ email: string, password: string, clearLocalHash?: boolean }} args
 * @returns {Promise<boolean>} true if Directus password was updated (caller should retry login)
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

    let link = findDirectusLinkForUser(localUser.id);
    if (!link?.external_id) {
        // Recover when migrate created the Directus user but this DB missed the link row.
        try {
            const dx = await findDirectusUserByEmail(identity);
            if (dx?.id) {
                linkIdentity(localUser.id, PROVIDER, String(dx.id));
                link = findDirectusLinkForUser(localUser.id);
                console.info(
                    'CUTOVER password-bridge: recovered Directus link for',
                    identity,
                    String(dx.id)
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

    if (!link?.external_id) {
        console.info('CUTOVER password-bridge: no Directus link for local user', localUser.id, identity);
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

    try {
        await updateDirectusUser(link.external_id, { password: pass });
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

    // Only clear after the caller confirms Directus login works with the new password.
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

    console.info(`CUTOVER password-bridge: synced local password to Directus for ${identity}`);
    return true;
}
