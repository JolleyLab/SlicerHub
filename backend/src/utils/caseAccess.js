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
import { getUserCaseRole, getUserCaseRoleMap } from '../services/keycloakAdmin.js';
import { getCaseRoleFromGroups, getCaseRoleMapFromGroups } from '../services/caseGroupAccess.js';


const ROLE_RANK = { admin: 3, collaborator: 2, read_only: 1 };

function higherRole(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (ROLE_RANK[b] ?? 0) > (ROLE_RANK[a] ?? 0) ? b : a;
}

/**
 * Returns the requesting user's effective role on a case,
 * or null if they have no access.
 *
 * Role sources (highest wins when more than one applies): direct Keycloak
 * group membership (case:{id}:{role}), and membership in a SlicerHub group
 * that has been added as a case collaborator.
 *
 * @param {object} caseDoc   Payload case document
 * @param {object} req       Express request (req.user must be populated)
 * @returns {Promise<'admin'|'collaborator'|'read_only'|null>}
 */
export async function getCaseRole(caseDoc, req) {
    if (req.user.role === 'admin' || req.user.role === 'org-admin') return 'admin';
    const requesterSub = req.user.keycloakSub;
    return getCaseRoleForSub(caseDoc, requesterSub);
}

/**
 * A Keycloak user's role on a case from ownership, direct Keycloak case groups and
 * SlicerHub group links. Unlike getCaseRole this works for any user, not just the
 * requester, and does not include site/org-admin realm roles (those live on the
 * requester's session, not on the case).
 *
 * @param {object} caseDoc
 * @param {string|null} kcSub
 * @returns {Promise<'admin'|'collaborator'|'read_only'|null>}
 */
export async function getCaseRoleForSub(caseDoc, kcSub) {
    if (!kcSub) return null;
    if (caseDoc.owner_id === kcSub) return 'admin';

    const [kcRole, groupRole] = await Promise.all([
        config.auth.provider === 'keycloak'
            ? getUserCaseRole(kcSub, String(caseDoc.id))
            : Promise.resolve(null),
        getCaseRoleFromGroups(kcSub, String(caseDoc.id)),
    ]);

    return higherRole(kcRole, groupRole);
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
    const keycloakSub = req.user.keycloakSub;
    if (!keycloakSub) return {};

    const [kcMap, groupMap] = await Promise.all([
        config.auth.provider === 'keycloak'
            ? getUserCaseRoleMap(keycloakSub).catch(() => ({}))
            : Promise.resolve({}),
        getCaseRoleMapFromGroups(keycloakSub).catch(() => ({})),
    ]);

    const merged = { ...kcMap };
    for (const [caseId, role] of Object.entries(groupMap)) {
        merged[caseId] = higherRole(merged[caseId], role);
    }
    return merged;
}
