/**
 * Case invites for existing Directus users.
 * - Case admin invite → membership applied immediately + notify invitee
 * - Collaborator invite → pending until a case admin approves
 */

import { findAppUserIdByDirectusExternalId } from '../auth/identityStore.js';
import { createNotification } from './notifications.js';
import { lookupDirectusUserByEmail, findDirectusUserByEmail } from './directus.js';
import {
    CASE_COLLAB_ROLES,
    requestedCaseRole,
    addCaseCollaborator,
    getCaseCollabActorContext
} from './caseCollaborators.js';
import {
    INVITE_STATUS,
    getInvite,
    createInvite,
    updateInvite,
    findOpenExistingUserInvite,
    listOpenForCase
} from './caseInviteStore.js';
import { inviteNewEmailToCase, expireStaleSignupInvites, withInviteUrl } from './caseSignupInvites.js';
import {
    ValidationError,
    ForbiddenError,
    NotFoundError,
    ConflictError
} from '../utils/errors.js';
import { msg } from '../i18n/index.js';

function normalizeRole(role, { allowAdmin }) {
    const requested = requestedCaseRole(role);
    return requested === CASE_COLLAB_ROLES.ADMIN && !allowAdmin ? CASE_COLLAB_ROLES.COLLABORATOR : requested;
}

/** Invites still waiting on a case, both kinds; signup invites whose link ran out are expired first. */
export async function listOpenInvitesForCase(caseId) {
    const key = String(caseId || '').trim();
    if (!key) return [];
    await expireStaleSignupInvites(key);
    return (await listOpenForCase(key)).map((invite) => withInviteUrl(invite));
}

function notifyAppUserForDirectusId(directusUserId, payload) {
    try {
        const appUserId = findAppUserIdByDirectusExternalId(directusUserId);
        if (!appUserId) return null;
        return createNotification({
            userId: appUserId,
            ...payload
        });
    } catch (err) {
        console.warn('Case invite notification skipped:', err.message || err);
        return null;
    }
}

function notifyCaseAdmins(ctx, payload) {
    const adminIds = new Set();
    for (const member of ctx.existingList || []) {
        if (member.role === CASE_COLLAB_ROLES.ADMIN && member.id) {
            adminIds.add(String(member.id));
        }
    }
    const out = [];
    for (const directusId of adminIds) {
        if (directusId === String(ctx.actorId)) continue;
        const n = notifyAppUserForDirectusId(directusId, payload);
        if (n) out.push(n);
    }
    return out;
}

/**
 * Invite by email: existing Directus user, or signup invite for unknown emails.
 */
export async function inviteExistingUserToCase({
    caseId,
    email,
    role,
    accessToken,
    actorDirectusUserId
}) {
    const normalized = String(email || '').trim().toLowerCase();
    // Existence check via service token — do not use NotFound as control flow for the client.
    const existingRow = await findDirectusUserByEmail(normalized);
    if (!existingRow?.id) {
        return inviteNewEmailToCase({
            caseId,
            email: normalized,
            role,
            accessToken,
            actorDirectusUserId
        });
    }

    let person;
    try {
        person = await lookupDirectusUserByEmail(normalized, { accessToken });
    } catch (err) {
        // Service saw the user; map from that row if clinician lookup is blocked.
        if (err instanceof NotFoundError || err?.statusCode === 404) {
            person = {
                id: String(existingRow.id),
                email: existingRow.email || normalized,
                firstName: existingRow.first_name || '',
                lastName: existingRow.last_name || '',
                username: existingRow.email || normalized
            };
        } else {
            throw err;
        }
    }

    const ctx = await getCaseCollabActorContext(caseId, {
        accessToken,
        actorDirectusUserId
    });

    if (!ctx.actorCanInvite) {
        throw new ForbiddenError(msg('case.invite_forbidden'), null, 'case.invite_forbidden');
    }

    const inviteeId = String(person.id);
    if (ctx.existingList.some((c) => String(c.id) === inviteeId)) {
        throw new ConflictError(msg('case.member_already_exists'), null, 'case.member_already_exists');
    }

    const proposedRole = normalizeRole(role, { allowAdmin: ctx.actorIsAdmin });
    const caseTitle = ctx.caseTitle || 'a case';

    if (ctx.actorIsAdmin) {
        const result = await addCaseCollaborator(caseId, inviteeId, proposedRole, {
            accessToken,
            actorDirectusUserId
        });
        // Keep a record of the invite, already approved, so it is traceable and shows in activity. The
        // person is on the case either way, so a failure here is logged, not raised.
        let record = null;
        try {
            record = await createInvite({
                kind: 'existing',
                status: INVITE_STATUS.APPROVED,
                caseId,
                inviteeEmail: person.email || email,
                inviteeUserId: inviteeId,
                proposedRole,
                inviterId: actorDirectusUserId,
                resolvedAt: new Date().toISOString(),
                resolvedById: actorDirectusUserId
            });
        } catch (err) {
            console.warn('Could not record the invite that was applied directly:', err.message || err);
        }
        const notification = notifyAppUserForDirectusId(inviteeId, {
            type: 'case_invite_accepted',
            title: `Added to case: ${caseTitle}`,
            body: `You were added as ${proposedRole.replace('_', ' ')} on “${caseTitle}”.`,
            caseId: String(caseId)
        });
        return {
            status: 'added',
            collaborators: result.collaborators,
            invite: record,
            notification: Boolean(notification),
            invitee: person
        };
    }

    // Collaborator: pending admin approval
    if (await findOpenExistingUserInvite(caseId, inviteeId)) {
        throw new ConflictError(msg('case.invite_pending_exists'), null, 'case.invite_pending_exists');
    }
    const invite = await createInvite({
        kind: 'existing',
        status: INVITE_STATUS.PENDING_APPROVAL,
        caseId,
        inviteeEmail: person.email || email,
        inviteeUserId: inviteeId,
        proposedRole,
        inviterId: actorDirectusUserId
    });

    notifyCaseAdmins(ctx, {
        type: 'case_invite_pending',
        title: `Invite pending: ${caseTitle}`,
        body: `${person.email || 'Someone'} was invited as ${proposedRole.replace('_', ' ')}. Approve or reject in People.`,
        caseId: String(caseId),
        inviteId: invite.id
    });

    return {
        status: 'pending',
        collaborators: ctx.existingList,
        invite,
        notification: false,
        invitee: person
    };
}

/** An existing-user invite that is still waiting for approval, or a not-found error. */
async function pendingExistingInvite(inviteId) {
    const invite = await getInvite(inviteId);
    if (!invite || invite.kind !== 'existing' || invite.status !== INVITE_STATUS.PENDING_APPROVAL) {
        throw new NotFoundError(msg('case.invite_pending_not_found'), null, 'case.invite_pending_not_found');
    }
    return invite;
}

export async function approveCaseInvite({ inviteId, accessToken, actorDirectusUserId }) {
    const invite = await pendingExistingInvite(inviteId);

    const ctx = await getCaseCollabActorContext(invite.caseId, { accessToken, actorDirectusUserId });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_approve_admin_only'), null, 'case.invite_approve_admin_only');
    }

    const already = ctx.existingList.some((c) => String(c.id) === invite.inviteeDirectusUserId);
    let collaborators = ctx.existingList;
    if (!already) {
        const result = await addCaseCollaborator(
            invite.caseId,
            invite.inviteeDirectusUserId,
            invite.proposedRole,
            { accessToken, actorDirectusUserId }
        );
        collaborators = result.collaborators;
    }

    const resolved = await updateInvite(invite.id, {
        status: INVITE_STATUS.APPROVED,
        resolved_at: new Date().toISOString(),
        resolved_by: String(actorDirectusUserId)
    });

    const caseTitle = invite.caseTitle || 'a case';
    notifyAppUserForDirectusId(invite.inviteeDirectusUserId, {
        type: 'case_invite_accepted',
        title: `Added to case: ${caseTitle}`,
        body: `Your invite to “${caseTitle}” was approved (${invite.proposedRole.replace('_', ' ')}).`,
        caseId: invite.caseId,
        inviteId: invite.id
    });

    return { status: 'approved', invite: resolved, collaborators };
}

export async function rejectCaseInvite({ inviteId, accessToken, actorDirectusUserId }) {
    const invite = await pendingExistingInvite(inviteId);

    const ctx = await getCaseCollabActorContext(invite.caseId, { accessToken, actorDirectusUserId });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_reject_admin_only'), null, 'case.invite_reject_admin_only');
    }

    const resolved = await updateInvite(invite.id, {
        status: INVITE_STATUS.REJECTED,
        resolved_at: new Date().toISOString(),
        resolved_by: String(actorDirectusUserId)
    });
    return { status: 'rejected', invite: resolved };
}
