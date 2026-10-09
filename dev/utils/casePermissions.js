// Pure helpers for case-level role and permission checks.
// All functions take plain data — no component state required.

/** Sort weight for a collaborator role: admin < collaborator < read_only/unknown. */
export function roleOrder(role) {
    if (role === 'admin') return 0;
    if (role === 'collaborator') return 1;
    return 2;
}

/**
 * Derive the current user's role on a case.
 * Returns 'admin' if the user created the case, the membership role string
 * if they are a collaborator, or null if they have no membership.
 */
export function getCaseRole(caseRow, currentUserId) {
    if (!currentUserId || !caseRow) return null;
    if (caseRow.createdBy?.id && String(caseRow.createdBy.id) === String(currentUserId)) {
        return 'admin';
    }
    const membership = (caseRow.collaborators || []).find(
        (c) => String(c.id) === String(currentUserId)
    );
    return membership?.role || null;
}

/** Only admins can add/remove/change collaborators. */
export function canManageCollaborators(role) {
    return role === 'admin';
}

/** Admins and collaborators can invite others. */
export function canInvite(role) {
    return role === 'admin' || role === 'collaborator';
}

/** Admins and collaborators can edit case content and upload files. */
export function canEditCase(role) {
    return role === 'admin' || role === 'collaborator';
}

/** True if the attachment was uploaded by the current user. */
export function isAttachmentOwner(attachment, currentUserId) {
    return !!currentUserId
        && !!attachment?.uploadedBy
        && String(attachment.uploadedBy) === String(currentUserId);
}
