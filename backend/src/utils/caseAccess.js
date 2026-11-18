/**
 * Case-level role resolution.
 *
 * Role hierarchy (highest → lowest): admin > collaborator > read_only
 *
 * A user's effective role on a case:
 *   1. Site admin (app-admin, isSiteAdmin)          → 'admin' on every case
 *   2. Case owner (owner_id === requester Keycloak sub) → 'admin'
 *   3. Keycloak group membership                    → group role
 *   4. No match                                     → null (access denied)
 *
 * Org admins (app-org-admin) manage registrations and groups; on cases they're like anyone else,
 * with only the roles their membership gives them.
 */

import config from '../config/index.js';
import { ForbiddenError, NotFoundError } from './errors.js';
import { getPayloadClient } from '../payload/index.js';
import { isDocId } from './validation.js';
import { getUserCaseRole, getUserCaseRoleMap, isSiteAdminAccount } from '../services/keycloakAdmin.js';
import { getCaseRoleFromGroups, getCaseRoleMapFromGroups } from '../services/caseGroupAccess.js';
import { SITE_ADMIN_CASE_ROLE, memberAccessRole } from './caseRoles.js';


const ROLE_RANK = { admin: 3, collaborator: 2, read_only: 1 };

/** A site admin (app-admin) is admin on every case. The one place that decides it. */
export const isSiteAdmin = (user) => user?.role === 'admin';

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
    if (isSiteAdmin(req.user)) return 'admin';
    const requesterSub = req.user.keycloakSub;
    return getCaseRoleForSub(caseDoc, requesterSub);
}

/**
 * A Keycloak user's role on a case from ownership, direct Keycloak case groups and
 * SlicerHub group links. Unlike getCaseRole this works for any user, not just the
 * requester, and does not include the site admin role (that lives on the requester's
 * session, not on the case).
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

    // The marker is admin while they're still a site admin, read only after (asked of Keycloak:
    // this is someone other than the requester, e.g. who a mention or a request outcome may reach).
    const stored = kcRole === SITE_ADMIN_CASE_ROLE && (await isSiteAdminAccount(kcSub))
        ? 'admin'
        : memberAccessRole(kcRole);
    return higherRole(stored, groupRole);
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
 * Load a case and check the requester has at least `minRole` on it — the opening of most
 * case-scoped routes. Throws NotFoundError / ForbiddenError.
 *
 * @returns {Promise<{ caseDoc: object, role: 'admin'|'collaborator'|'read_only' }>}
 */
export async function loadCaseWithAccess(caseId, req, minRole = 'read_only') {
    const caseDoc = isDocId(caseId)
        ? await getPayloadClient().findByID({ collection: 'cases', id: caseId, depth: 0, disableErrors: true })
        : null;
    if (!caseDoc) throw new NotFoundError('Case not found');
    const role = await assertCaseAccess(caseDoc, req, minRole);
    return { caseDoc, role };
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

    // The requester's own list: a former site admin's marker is read only (a current site admin
    // is admin on every case through their role, whatever this says).
    const merged = Object.fromEntries(Object.entries(kcMap).map(([caseId, role]) => [caseId, memberAccessRole(role)]));
    for (const [caseId, role] of Object.entries(groupMap)) {
        merged[caseId] = higherRole(merged[caseId], role);
    }
    return merged;
}

/**
 * A `where` condition on `field` (a case relationship) for the cases the requester administers,
 * or null when there are none. For "awaiting approval" lists (invites, workflow requests: the bell and
 * To do). Site admins administer every case; everyone else the cases they own or are admin of
 * through Keycloak or SlicerHub groups.
 */
export async function administeredCasesWhere(req, field = 'case') {
    if (isSiteAdmin(req.user)) return { [field]: { exists: true } };
    const ids = await adminCaseIds(req);
    return ids.length ? { [field]: { in: ids } } : null;
}

/** IDs (strings) of the cases a user who isn't a site admin owns or is admin of. */
async function adminCaseIds(req) {
    const keycloakSub = req.user.keycloakSub;
    if (!keycloakSub) return [];
    const [roleMap, owned] = await Promise.all([
        buildCaseRoleMap(req),
        getPayloadClient().find({ collection: 'cases', where: { owner_id: { equals: keycloakSub } }, limit: 200, depth: 0 }),
    ]);
    return [...new Set([
        ...Object.entries(roleMap).filter(([, role]) => role === 'admin').map(([id]) => String(id)),
        ...owned.docs.map((d) => String(d.id)),
    ])];
}
