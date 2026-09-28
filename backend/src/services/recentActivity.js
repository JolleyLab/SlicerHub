/**
 * Recent activity for the Home page, built from the invites in Directus: an event when an invite was
 * sent and another when it was approved. Only cases where the user is an admin or collaborator (the
 * people who can already see pending invites in the People dialog) contribute.
 *
 * Not covered: an admin adding someone directly leaves no invite record, so it has no event here. That
 * belongs to a real audit trail.
 */

import { CASE_COLLAB_ROLES, listCaseIdsForUser } from './caseCollaborators.js';
import { listRecentForCases } from './caseInviteStore.js';

export const ACTIVITY_TYPES = Object.freeze({
    INVITE_SENT: 'invite_sent',
    INVITE_APPROVED: 'invite_approved'
});

function eventsForInvite(invite, userId) {
    const base = {
        inviteId: invite.id,
        caseId: invite.caseId,
        caseTitle: invite.caseTitle,
        inviteeEmail: invite.inviteeEmail,
        inviteeName: invite.inviteeName,
        proposedRole: invite.proposedRole
    };
    const events = [];
    if (invite.createdAt) {
        events.push({
            ...base,
            id: `${ACTIVITY_TYPES.INVITE_SENT}:${invite.id}`,
            type: ACTIVITY_TYPES.INVITE_SENT,
            at: invite.createdAt,
            actorName: invite.inviterName,
            actorIsMe: invite.inviterDirectusUserId === userId
        });
    }
    // An approval is a second person's decision. An admin who added someone directly resolved their own
    // invite in the same moment, so that is one event ("sent"), not two.
    const addedDirectly = invite.resolvedByDirectusUserId
        && invite.resolvedByDirectusUserId === invite.inviterDirectusUserId;
    if (invite.status === 'approved' && invite.resolvedAt && !addedDirectly) {
        events.push({
            ...base,
            id: `${ACTIVITY_TYPES.INVITE_APPROVED}:${invite.id}`,
            type: ACTIVITY_TYPES.INVITE_APPROVED,
            at: invite.resolvedAt,
            actorName: invite.resolvedByName,
            actorIsMe: invite.resolvedByDirectusUserId === userId
        });
    }
    return events;
}

/**
 * @param {{ userId: string, limit?: number, listCaseIds?: Function, listInvites?: Function }} options
 * @returns {Promise<object[]>} events, newest first
 */
export async function listRecentActivity({
    userId,
    limit = 20,
    listCaseIds = listCaseIdsForUser,
    listInvites = listRecentForCases
}) {
    const uid = String(userId || '');
    if (!uid) return [];
    const caseIds = await listCaseIds(uid, [CASE_COLLAB_ROLES.ADMIN, CASE_COLLAB_ROLES.COLLABORATOR]);
    const invites = await listInvites(caseIds);
    return invites
        .flatMap((invite) => eventsForInvite(invite, uid))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, limit);
}
