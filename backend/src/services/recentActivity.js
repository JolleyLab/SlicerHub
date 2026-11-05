/**
 * Recent activity for the Home page, built from Payload case-invites, case-comments, and
 * attachments. Only cases where the user is an admin or collaborator (KC group membership) or
 * owner (Payload-owned case) contribute.
 */

import { getUserCaseRoleMap, getKeycloakUser, kcDisplayName } from './keycloakAdmin.js';
import { getCaseRoleMapFromGroups } from './caseGroupAccess.js';
import { getGroup } from './groupStore.js';

export const ACTIVITY_TYPES = Object.freeze({
    INVITE_SENT: 'invite_sent',
    INVITE_APPROVED: 'invite_approved',
    COMMENT_POSTED: 'comment_posted',
    ATTACHMENT_UPLOADED: 'attachment_uploaded',
});

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

    // Case IDs from KC group membership or SlicerHub group access (admin + collaborator only)
    const [roleMap, groupRoleMap] = await Promise.all([
        getUserCaseRoleMap(kcSub),
        getCaseRoleMapFromGroups(kcSub).catch(() => ({})),
    ]);
    const kcCaseIds = [...Object.entries(roleMap), ...Object.entries(groupRoleMap)]
        .filter(([, role]) => role === 'admin' || role === 'collaborator')
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

    const groupNames = {};
    await Promise.all(
        [...new Set(inviteResult.docs.filter(d => d.kind === 'group').map(d => d.group_id))]
            .map(async (groupId) => {
                const group = await getGroup(groupId).catch(() => null);
                groupNames[groupId] = group?.name || null;
            })
    );

    const inviteEvents = inviteResult.docs.flatMap((invite) => {
        const caseId = String(invite.case?.id ?? invite.case);
        const caseTitle = invite.case?.title ?? null;
        const base = {
            inviteId: String(invite.id),
            caseId,
            caseTitle,
            inviteeEmail: invite.invitee_email,
            inviteeName: invite.kind === 'group' ? groupNames[invite.group_id] : invite.invitee_email,
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
