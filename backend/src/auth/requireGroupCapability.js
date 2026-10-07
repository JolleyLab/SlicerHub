/**
 * Middleware factory: gate a route on a task group capability.
 *
 * Chain after: authenticateToken → requireDirectusLink → requireDirectusUserToken
 *
 * Passes when any of the following is true:
 *   - Caller's Directus role has admin_access (Directus Administrator superuser)
 *   - Caller's Directus role name is 'OrgAdmin'
 *   - Caller is a member of the task group designated for the given capability
 *
 * Fetches and caches req.directusProfile exactly like requireDirectusRole so the
 * two middlewares can be swapped without losing the cached profile.
 */

import { fetchDirectusViewer } from '../services/directus.js';
import { findDirectusLinkForUser } from './identityStore.js';
import { isUserInCapabilityGroup } from '../services/groupCapabilities.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

async function resolveDirectusProfile(req) {
    if (req.directusProfile) return req.directusProfile;
    const profile = await fetchDirectusViewer(req.directusAccessToken);
    if (profile) req.directusProfile = profile;
    return profile;
}

/**
 * @param {string} capability  A CAPABILITIES constant, e.g. CAPABILITIES.APPROVE_REGISTRATIONS
 */
export function requireGroupCapability(capability) {
    return async (req, res, next) => {
        if (!req.directusAccessToken) {
            return next(new UnauthorizedError(
                msg('directus.session_sign_in_once'),
                'DIRECTUS_SESSION_REQUIRED',
                'directus.session_sign_in_once'
            ));
        }

        let profile;
        try {
            profile = await resolveDirectusProfile(req);
        } catch (err) {
            return next(err);
        }

        if (!profile) {
            return next(new ForbiddenError(
                msg('directus.link_required'),
                'DIRECTUS_PROFILE_MISSING',
                'directus.link_required'
            ));
        }

        // Directus Administrator superuser and OrgAdmin always pass
        if (profile.adminAccess || profile.roleName === 'OrgAdmin') {
            return next();
        }

        // Check capability group membership via the local user's Directus link
        try {
            const link = findDirectusLinkForUser(req.user?.id);
            const directusUserId = link?.external_id;
            if (directusUserId && await isUserInCapabilityGroup(directusUserId, capability)) {
                return next();
            }
        } catch (err) {
            return next(err);
        }

        return next(new ForbiddenError(
            msg('auth.insufficient_role'),
            'INSUFFICIENT_CAPABILITY',
            'auth.insufficient_role'
        ));
    };
}
