// Backend-agnostic case service.
// All components import from here; never import the Directus-specific names directly.
import {
    listDirectusCases,
    createDirectusCase,
    updateDirectusCase,
    createDirectusCaseComment,
    lookupDirectusUserByEmail,
    updateDirectusCaseCollaborators,
    listDirectusCaseInvites,
    inviteDirectusCaseUser,
    approveDirectusCaseInvite,
    rejectDirectusCaseInvite,
    listInvitesAwaitingMyApproval,
    listRecentActivity,
    fetchCaseActivity,
    friendlyCasesError,
} from './directus.js';

// listCases normalizes the session identity so callers never read .directusViewer.id directly.
export async function listCases(options) {
    const data = await listDirectusCases(options);
    return {
        ...data,
        currentUserId: data.meta?.directusViewer?.id || data.meta?.directusUserId || null,
    };
}

export {
    createDirectusCase as createCase,
    updateDirectusCase as updateCase,
    createDirectusCaseComment as postComment,
    lookupDirectusUserByEmail as lookupUserByEmail,
    updateDirectusCaseCollaborators as updateCollaborators,
    listDirectusCaseInvites as listInvites,
    inviteDirectusCaseUser as inviteUser,
    approveDirectusCaseInvite as approveInvite,
    rejectDirectusCaseInvite as rejectInvite,
    listInvitesAwaitingMyApproval,
    listRecentActivity,
    fetchCaseActivity,
    friendlyCasesError as friendlyError,
};
