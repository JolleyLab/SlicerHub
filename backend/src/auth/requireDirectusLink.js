/**
 * Enforce Directus-linked product users for collab features.
 * Identity model: every app user who uses Directus-backed features
 * must have auth_identity_links (provider=directus).
 */

import config from '../config/index.js';
import { ForbiddenError } from '../utils/errors.js';
import { findDirectusLinkForUser } from './identityStore.js';
import { msg } from '../i18n/index.js';

export function isDirectusLinkRequired() {
    if (config.auth?.requireDirectusLink === true) return true;
    if (config.auth?.requireDirectusLink === false) return false;
    // Default on when Cases (or broader Directus product path) is enabled
    return config.directus?.casesEnabled === true;
}

/**
 * After authenticateToken: require Directus identity link.
 */
export function requireDirectusLink(req, res, next) {
    if (!isDirectusLinkRequired()) {
        return next();
    }

    const userId = req.user?.id;
    if (!userId) {
        return next(new ForbiddenError(msg('auth.authentication_required'), 'AUTH_REQUIRED', 'auth.authentication_required'));
    }

    const link = findDirectusLinkForUser(userId);
    if (!link) {
        return next(new ForbiddenError(
            msg('directus.link_required'),
            'DIRECTUS_LINK_REQUIRED',
            'directus.link_required'
        ));
    }

    req.directusIdentity = {
        externalId: link.external_id,
        linkId: link.id
    };
    return next();
}
