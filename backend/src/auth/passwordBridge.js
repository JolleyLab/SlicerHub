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
import { findDirectusLinkForUser } from './identityStore.js';
import { updateDirectusUser } from '../services/directus.js';
import { AppError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

export function isPasswordBridgeEnabled() {
    return config.auth?.passwordBridge === true;
}

/**
 * @param {{ email: string, password: string }} args
 * @returns {Promise<boolean>} true if Directus password was updated (caller should retry login)
 */
export async function tryBridgeLocalPasswordToDirectus({ email, password }) {
    if (!isPasswordBridgeEnabled()) return false;

    const identity = String(email || '').trim().toLowerCase();
    const pass = String(password || '');
    if (!identity.includes('@') || !pass) return false;

    const localUser = User.findByEmail(identity);
    if (!localUser || localUser.is_active === 0 || localUser.is_active === false) {
        return false;
    }

    const link = findDirectusLinkForUser(localUser.id);
    if (!link?.external_id) {
        return false;
    }

    if (!User.hasLocalPasswordHash(localUser.id)) {
        return false;
    }

    const verified = await User.verifyPassword(identity, pass);
    if (!verified || Number(verified.id) !== Number(localUser.id)) {
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

    try {
        await User.clearLocalPasswordHash(localUser.id);
    } catch (err) {
        console.warn(
            'CUTOVER password-bridge: Directus password set but local hash clear failed:',
            err.message || err
        );
    }

    console.info(`CUTOVER password-bridge: synced local password to Directus for ${identity}`);
    return true;
}
