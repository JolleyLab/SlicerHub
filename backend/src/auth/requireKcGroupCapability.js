import { isUserInCapabilityGroup } from '../services/groupCapabilities.js';
import { ForbiddenError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

/**
 * Middleware: gate a route on a Payload capability group.
 * Chain after: authenticateToken (Keycloak path only).
 *
 * @param {string} capability  A CAPABILITIES constant
 * @param {Function} [checkFn] Override for testing; defaults to isUserInCapabilityGroup
 */
export function requireKcGroupCapability(capability, checkFn = isUserInCapabilityGroup) {
    return async (req, res, next) => {
        const kcSub = req.user?.keycloakSub || null;
        if (!kcSub) {
            return next(new ForbiddenError(msg('auth.insufficient_role'), 'INSUFFICIENT_CAPABILITY', 'auth.insufficient_role'));
        }
        try {
            const inGroup = await checkFn(kcSub, capability);
            if (inGroup) return next();
        } catch (err) {
            return next(err);
        }
        return next(new ForbiddenError(msg('auth.insufficient_role'), 'INSUFFICIENT_CAPABILITY', 'auth.insufficient_role'));
    };
}
