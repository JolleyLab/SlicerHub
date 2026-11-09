// Pure helpers for case-level role and permission checks.
// All functions take plain data — no component state required.

/** Sort weight for a collaborator role: admin < collaborator < read_only/unknown. */
export function roleOrder(role) {
    if (role === 'admin') return 0;
    if (role === 'collaborator') return 1;
    return 2;
}

/** Only admins can add/remove/change collaborators. */
export function canManageCollaborators(role) {
    return role === 'admin';
}

/** Admins and collaborators can edit case content and upload files. */
export function canEditCase(role) {
    return role === 'admin' || role === 'collaborator';
}
