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
import { getUserCaseRoleMap, getKeycloakUser, kcDisplayName } from './keycloakAdmin.js';

export const ACTIVITY_TYPES = Object.freeze({
    INVITE_SENT: 'invite_sent',
    INVITE_APPROVED: 'invite_approved',
    COMMENT_POSTED: 'comment_posted',
    ATTACHMENT_UPLOADED: 'attachment_uploaded',
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
 * Payload + Keycloak version of recent activity.
 * Uses KC group membership for case IDs and Payload case-invites for events.
 * @param {{ kcSub: string, limit?: number, payload: object }} options
 */
export async function listRecentActivityKC({
    kcSub,
    limit = 20,
    payload: payloadClient,
}) {
    if (!kcSub || !payloadClient) return [];

    // Case IDs from KC group membership (admin + collaborator only)
    const roleMap = await getUserCaseRoleMap(kcSub);
    const kcCaseIds = Object.entries(roleMap)
        .filter(([, role]) => role === CASE_COLLAB_ROLES.ADMIN || role === CASE_COLLAB_ROLES.COLLABORATOR)
        .map(([id]) => String(id));

    // Cases owned by this user in Payload
    const ownedResult = await payloadClient.find({
        collection: 'cases',
        where: { owner_id: { equals: kcSub } },
        limit: 200,
        depth: 0,
    });
    const ownedIds = ownedResult.docs.map(d => String(d.id));

    const allCaseIds = [...new Set([...kcCaseIds, ...ownedIds])];
    if (!allCaseIds.length) return [];

    // Recent invites on those cases (fetch extra to account for multi-event expansion)
    const inviteResult = await payloadClient.find({
        collection: 'case-invites',
        where: { case: { in: allCaseIds } },
        sort: '-createdAt',
        limit: limit * 3,
        depth: 1,
    });

    // Resolve inviter display names from KC
    const inviterSubs = [...new Set(inviteResult.docs.map(d => d.inviter_id).filter(Boolean))];
    const nameMap = {};
    await Promise.all(inviterSubs.map(async (sub) => {
        const user = await getKeycloakUser(sub);
        if (user) nameMap[sub] = kcDisplayName(user) || null;
    }));

    const inviteEvents = inviteResult.docs.flatMap((invite) => {
        const caseId = String(invite.case?.id ?? invite.case);
        const caseTitle = invite.case?.title ?? null;
        const base = {
            inviteId: String(invite.id),
            caseId,
            caseTitle,
            inviteeEmail: invite.invitee_email,
            inviteeName: invite.invitee_email,
            proposedRole: invite.role,
        };
        if (!invite.createdAt) return [];
        return [{
            ...base,
            id: `${ACTIVITY_TYPES.INVITE_SENT}:${invite.id}`,
            type: ACTIVITY_TYPES.INVITE_SENT,
            at: invite.createdAt,
            actorName: nameMap[invite.inviter_id] ?? null,
            actorIsMe: invite.inviter_id === kcSub,
        }];
    });

    // Recent comments on the user's cases (skip own comments)
    const commentResult = await payloadClient.find({
        collection: 'case-comments',
        where: { case: { in: allCaseIds } },
        sort: '-createdAt',
        limit: limit * 3,
        depth: 1,
    });
    const commentAuthorSubs = [...new Set(commentResult.docs.map(d => d.author_id).filter(Boolean))];
    await Promise.all(commentAuthorSubs.filter(s => !nameMap[s]).map(async (sub) => {
        const user = await getKeycloakUser(sub);
        if (user) nameMap[sub] = kcDisplayName(user) || null;
    }));
    const commentEvents = commentResult.docs
        .filter(c => c.author_id !== kcSub) // skip own comments
        .flatMap((c) => {
            if (!c.createdAt) return [];
            const caseId = String(c.case?.id ?? c.case);
            const caseTitle = c.case?.title ?? null;
            return [{
                id: `${ACTIVITY_TYPES.COMMENT_POSTED}:${c.id}`,
                type: ACTIVITY_TYPES.COMMENT_POSTED,
                caseId,
                caseTitle,
                at: c.createdAt,
                actorName: nameMap[c.author_id] ?? null,
                actorIsMe: false,
                commentBody: String(c.body || '').slice(0, 200),
            }];
        });

    // Recent file uploads on the user's cases
    const attachResult = await payloadClient.find({
        collection: 'attachments',
        where: { case: { in: allCaseIds } },
        sort: '-createdAt',
        limit: limit * 3,
        depth: 1,
    });
    const attachUploaderSubs = [...new Set(attachResult.docs.map(d => d.uploaded_by).filter(Boolean))];
    await Promise.all(attachUploaderSubs.filter(s => !nameMap[s]).map(async (sub) => {
        const user = await getKeycloakUser(sub);
        if (user) nameMap[sub] = kcDisplayName(user) || null;
    }));
    const attachmentEvents = attachResult.docs.flatMap((a) => {
        if (!a.createdAt) return [];
        const caseId = String(a.case?.id ?? a.case);
        const caseTitle = a.case?.title ?? null;
        return [{
            id: `${ACTIVITY_TYPES.ATTACHMENT_UPLOADED}:${a.id}`,
            type: ACTIVITY_TYPES.ATTACHMENT_UPLOADED,
            caseId,
            caseTitle,
            at: a.createdAt,
            actorName: nameMap[a.uploaded_by] ?? null,
            actorIsMe: a.uploaded_by === kcSub,
            fileName: a.original_filename,
        }];
    });

    return [...inviteEvents, ...commentEvents, ...attachmentEvents]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, limit);
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
