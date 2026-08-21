/**
 * Enforce Directus-linked product users for collab features.
 * Identity model: every app user who uses Directus-backed features
 * must have auth_identity_links (provider=directus).
 */

import config from '../config/index.js';
import { ForbiddenError } from '../utils/errors.js';
import { findDirectusLinkForUser } from './identityStore.js';

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
        return next(new ForbiddenError('Authentication required', 'AUTH_REQUIRED'));
    }

    const link = findDirectusLinkForUser(userId);
    if (!link) {
        return next(new ForbiddenError(
            'This account is not linked to Directus. Sign in with your Directus credentials '
            + '(or complete account setup) so collaboration features can act as you.',
            'DIRECTUS_LINK_REQUIRED'
        ));
    }

    req.directusIdentity = {
        externalId: link.external_id,
        linkId: link.id
    };
    return next();
}
