/**
 * Case-level role resolution.
 *
 * Role hierarchy (highest → lowest): admin > collaborator > read_only
 *
 * A user's effective role on a case:
 *   1. Site-level admin (req.user.role === 'admin') → 'admin'
 *   2. Case owner (owner_id === requester Keycloak sub) → 'admin'
 *   3. Keycloak group membership                    → group role
 *   4. No match                                     → null (access denied)
 */

import config from '../config/index.js';
import { ForbiddenError } from './errors.js';
import { getKeycloakSubForUser, getUserCaseRole, getUserCaseRoleMap } from '../services/keycloakAdmin.js';


const ROLE_RANK = { admin: 3, collaborator: 2, read_only: 1 };

/**
 * Returns the requesting user's effective role on a case,
 * or null if they have no access.
 *
 * @param {object} caseDoc   Payload case document
 * @param {object} req       Express request (req.user must be populated)
 * @returns {Promise<'admin'|'collaborator'|'read_only'|null>}
 */
export async function getCaseRole(caseDoc, req) {
    if (req.user.role === 'admin') return 'admin';
    const requesterSub = getKeycloakSubForUser(req.user.id);
    if (requesterSub && caseDoc.owner_id === requesterSub) return 'admin';

    if (config.auth.provider === 'keycloak') {
        const keycloakSub = getKeycloakSubForUser(req.user.id);
        if (keycloakSub) {
            const role = await getUserCaseRole(keycloakSub, String(caseDoc.id));
            if (role) return role;
        }
    }

    return null;
}

/**
 * Throws ForbiddenError if the user doesn't have at least `minRole` on the case.
 * Returns the effective role on success.
 *
 * @param {object} caseDoc
 * @param {object} req
 * @param {'read_only'|'collaborator'|'admin'} [minRole='read_only']
 * @returns {Promise<'admin'|'collaborator'|'read_only'>}
 */
export async function assertCaseAccess(caseDoc, req, minRole = 'read_only') {
    const role = await getCaseRole(caseDoc, req);
    if (!role || (ROLE_RANK[role] ?? 0) < (ROLE_RANK[minRole] ?? 0)) {
        throw new ForbiddenError();
    }
    return role;
}

/**
 * Build a caseId → role map for the requesting user from Keycloak groups.
 * Used to annotate the case listing with `myRole`.
 *
 * Returns {} if Keycloak is not configured or user has no Keycloak link.
 */
export async function buildCaseRoleMap(req) {
    if (config.auth.provider !== 'keycloak') return {};
    const keycloakSub = getKeycloakSubForUser(req.user.id);
    if (!keycloakSub) return {};
    try {
        return await getUserCaseRoleMap(keycloakSub);
    } catch {
        return {};
    }
}
