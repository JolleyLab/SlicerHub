/**
 * Role-based access middleware for Keycloak-authenticated users.
 *
 * Reads req.user.role (set at login from JWT claims; no live IdP call).
 * Drop-in replacement for requireDirectusRole when AUTH_PROVIDER=keycloak.
 */

import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';

const ROLE_RANK = { 'user': 0, 'org-admin': 1, 'admin': 2 };

function rank(role) {
    return ROLE_RANK[String(role || '').toLowerCase()] ?? -1;
}

/**
 * Require the authenticated user to have at least the given role.
 *
 * @param {'user' | 'org-admin' | 'admin'} minimumRole
 */
export function requireRole(minimumRole) {
    return function roleGuard(req, res, next) {
        if (!req.user) {
            return next(new UnauthorizedError());
        }
        if (rank(req.user.role) < rank(minimumRole)) {
            return next(new ForbiddenError());
        }
        next();
    };
}

/** Convenience: require admin */
export const requireAdmin = requireRole('admin');

/** Convenience: require org-admin or higher */
export const requireOrgAdmin = requireRole('org-admin');
