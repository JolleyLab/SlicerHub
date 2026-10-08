/**
 * Middleware: gate a route by Directus role name.
 *
 * Chain after: authenticateToken → requireDirectusLink → requireDirectusUserToken
 *
 * Fetches and caches the caller's Directus profile on req.directusProfile so
 * subsequent middleware or route handlers can read role/name without a second
 * network call. (Avoids "viewer" which means something else in this app.)
 *
 * Passes when:
 *   - the user's Directus role has admin_access (Administrator / superuser), OR
 *   - the user's Directus role name is in the provided list
 */

import { fetchDirectusViewer } from '../services/directus.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

/**
 * Fetch and cache the caller's Directus profile on req.directusProfile.
 * Reuses a cached value if already set earlier in the middleware chain.
 * @returns {Promise<object|null>}
 */
async function resolveDirectusProfile(req) {
    if (req.directusProfile) return req.directusProfile;
    const profile = await fetchDirectusViewer(req.directusAccessToken);
    if (profile) req.directusProfile = profile;
    return profile;
}

/**
 * requireDirectusRole(...roleNames)
 *
 * Pass role name strings as arguments. Directus Administrator (admin_access)
 * always passes regardless of named roles — it is the superuser path.
 *
 * Example:
 *   app.post('/api/org/something',
 *     authenticateToken,
 *     requireDirectusLink,
 *     requireDirectusUserToken,
 *     requireDirectusRole('OrgAdmin'),
 *     asyncHandler(handler)
 *   );
 */
export function requireDirectusRole(...roleNames) {
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

        if (profile.adminAccess) {
            return next();
        }

        if (roleNames.length > 0 && roleNames.includes(profile.roleName)) {
            return next();
        }

        return next(new ForbiddenError(
            msg('auth.insufficient_role'),
            'INSUFFICIENT_ORG_ROLE',
            'auth.insufficient_role'
        ));
    };
}
