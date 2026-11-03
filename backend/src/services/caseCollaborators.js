/**
 * Case collaborator role constants and pure helpers shared by legacy Directus Cases code
 * (services/directus.js) and recent activity. Collaborators themselves live in KC groups.
 */

export const CASE_COLLAB_ROLES = Object.freeze({
    ADMIN: 'admin',
    COLLABORATOR: 'collaborator',
    READ_ONLY: 'read_only'
});

const KNOWN_ROLES = new Set(Object.values(CASE_COLLAB_ROLES));

/** A role as stored: one of the three values, or null (missing or unrecognised). */
export function parseCaseRole(value) {
    const role = typeof value === 'string' ? value.trim() : '';
    return KNOWN_ROLES.has(role) ? role : null;
}

/** What the UI shows: a member whose role is unusable is shown as read only, the least access. */
export function toDisplayMember(member) {
    return { ...member, role: member.role || CASE_COLLAB_ROLES.READ_ONLY };
}

// Stubs retained for legacy import compatibility — collaborators now live in KC groups.
// eslint-disable-next-line no-unused-vars
export async function listMembersByCaseIds(_caseIds) { return {}; }
// eslint-disable-next-line no-unused-vars
export async function listMembersByCaseIdsAsUser(_caseIds, _accessToken) { return {}; }
// eslint-disable-next-line no-unused-vars
export async function addCaseCreatorAsAdmin(_caseId, _creatorId) {}
