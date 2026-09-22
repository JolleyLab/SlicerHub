/**
 * Case invites for existing Directus users.
 * - Case admin invite → membership applied immediately + notify invitee
 * - Collaborator invite → pending until a case admin approves
 */

import db from '../db/database.js';
import { findAppUserIdByDirectusExternalId } from '../auth/identityStore.js';
import { createNotification } from './notifications.js';
import {
    CASE_COLLAB_ROLES,
    lookupDirectusUserByEmail,
    findDirectusUserByEmail,
    addCaseCollaborator,
    getCaseCollabActorContext
} from './directus.js';
import { inviteNewEmailToCase } from './caseSignupInvites.js';
import {
    ValidationError,
    ForbiddenError,
    NotFoundError,
    ConflictError
} from '../utils/errors.js';
import { msg } from '../i18n/index.js';

function normalizeRole(role, { allowAdmin }) {
    const raw = String(role || '').trim().toLowerCase();
    if (raw === CASE_COLLAB_ROLES.ADMIN || raw === 'admin') {
        return allowAdmin ? CASE_COLLAB_ROLES.ADMIN : CASE_COLLAB_ROLES.COLLABORATOR;
    }
    if (raw === CASE_COLLAB_ROLES.READ_ONLY || raw === 'read_only' || raw === 'readonly' || raw === 'observer') {
        return CASE_COLLAB_ROLES.READ_ONLY;
    }
    return CASE_COLLAB_ROLES.COLLABORATOR;
}

function mapInviteRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        kind: 'existing',
        caseId: row.case_id,
        caseTitle: row.case_title || null,
        inviteeDirectusUserId: row.invitee_directus_user_id,
        inviteeEmail: row.invitee_email,
        proposedRole: row.proposed_role,
        inviterDirectusUserId: row.inviter_directus_user_id,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at || null
    };
}

export function listPendingInvitesForCase(caseId) {
    const caseKey = String(caseId || '').trim();
    if (!caseKey) return [];
    return db.prepare(`
        SELECT * FROM case_invites
        WHERE case_id = ? AND status = 'pending'
        ORDER BY created_at DESC
    `).all(caseKey).map(mapInviteRow);
}

export function getInviteById(inviteId) {
    const row = db.prepare('SELECT * FROM case_invites WHERE id = ?').get(Number(inviteId));
    return mapInviteRow(row);
}

function insertPendingInvite({
    caseId,
    caseTitle,
    inviteeDirectusUserId,
    inviteeEmail,
    proposedRole,
    inviterDirectusUserId,
    inviterAppUserId
}) {
    const existing = db.prepare(`
        SELECT id FROM case_invites
        WHERE case_id = ? AND invitee_directus_user_id = ? AND status = 'pending'
        LIMIT 1
    `).get(String(caseId), String(inviteeDirectusUserId));
    if (existing) {
        throw new ConflictError(msg('case.invite_pending_exists'), null, 'case.invite_pending_exists');
    }

    const result = db.prepare(`
        INSERT INTO case_invites (
            case_id, case_title, invitee_directus_user_id, invitee_email,
            proposed_role, inviter_directus_user_id, inviter_app_user_id, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
        String(caseId),
        caseTitle || null,
        String(inviteeDirectusUserId),
        String(inviteeEmail || '').toLowerCase(),
        proposedRole,
        String(inviterDirectusUserId),
        inviterAppUserId != null ? Number(inviterAppUserId) : null
    );
    return getInviteById(result.lastInsertRowid);
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
    if (ctx.ownerId) adminIds.add(String(ctx.ownerId));
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
    actorDirectusUserId,
    actorAppUserId = null
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
            actorDirectusUserId,
            actorAppUserId
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
    if (inviteeId === String(ctx.ownerId)) {
        throw new ValidationError(msg('case.owner_already_member'), null, 'case.owner_already_member');
    }
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
        const notification = notifyAppUserForDirectusId(inviteeId, {
            type: 'case_invite_accepted',
            title: `Added to case: ${caseTitle}`,
            body: `You were added as ${proposedRole.replace('_', ' ')} on “${caseTitle}”.`,
            caseId: String(caseId)
        });
        return {
            status: 'added',
            collaborators: result.collaborators,
            invite: null,
            notification: Boolean(notification),
            invitee: person
        };
    }

    // Collaborator: pending admin approval
    const invite = insertPendingInvite({
        caseId,
        caseTitle,
        inviteeDirectusUserId: inviteeId,
        inviteeEmail: person.email || email,
        proposedRole,
        inviterDirectusUserId: actorDirectusUserId,
        inviterAppUserId: actorAppUserId
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

export async function approveCaseInvite({
    inviteId,
    accessToken,
    actorDirectusUserId
}) {
    const row = db.prepare('SELECT * FROM case_invites WHERE id = ?').get(Number(inviteId));
    if (!row || row.status !== 'pending') {
        throw new NotFoundError(msg('case.invite_pending_not_found'), null, 'case.invite_pending_not_found');
    }

    const ctx = await getCaseCollabActorContext(row.case_id, {
        accessToken,
        actorDirectusUserId
    });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_approve_admin_only'), null, 'case.invite_approve_admin_only');
    }

    const already = ctx.existingList.some(
        (c) => String(c.id) === String(row.invitee_directus_user_id)
    );
    let collaborators = ctx.existingList;
    if (!already) {
        const result = await addCaseCollaborator(
            row.case_id,
            row.invitee_directus_user_id,
            row.proposed_role,
            { accessToken, actorDirectusUserId }
        );
        collaborators = result.collaborators;
    }

    db.prepare(`
        UPDATE case_invites
        SET status = 'approved',
            resolved_at = CURRENT_TIMESTAMP,
            resolved_by_directus_user_id = ?
        WHERE id = ?
    `).run(String(actorDirectusUserId), row.id);

    const caseTitle = row.case_title || 'a case';
    notifyAppUserForDirectusId(row.invitee_directus_user_id, {
        type: 'case_invite_accepted',
        title: `Added to case: ${caseTitle}`,
        body: `Your invite to “${caseTitle}” was approved (${String(row.proposed_role).replace('_', ' ')}).`,
        caseId: String(row.case_id),
        inviteId: row.id
    });

    return {
        status: 'approved',
        invite: getInviteById(row.id),
        collaborators
    };
}

export async function rejectCaseInvite({
    inviteId,
    accessToken,
    actorDirectusUserId
}) {
    const row = db.prepare('SELECT * FROM case_invites WHERE id = ?').get(Number(inviteId));
    if (!row || row.status !== 'pending') {
        throw new NotFoundError(msg('case.invite_pending_not_found'), null, 'case.invite_pending_not_found');
    }

    const ctx = await getCaseCollabActorContext(row.case_id, {
        accessToken,
        actorDirectusUserId
    });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_reject_admin_only'), null, 'case.invite_reject_admin_only');
    }

    db.prepare(`
        UPDATE case_invites
        SET status = 'rejected',
            resolved_at = CURRENT_TIMESTAMP,
            resolved_by_directus_user_id = ?
        WHERE id = ?
    `).run(String(actorDirectusUserId), row.id);

    return {
        status: 'rejected',
        invite: getInviteById(row.id)
    };
}
