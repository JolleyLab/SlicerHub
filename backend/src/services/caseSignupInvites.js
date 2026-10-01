/**
 * Case signup invites for emails that are not yet Directus users.
 * No Directus account until the invitee redeems an unexpired, single-use link.
 */

import crypto from 'crypto';
import config from '../config/index.js';
import User from '../models/User.js';
import {
    linkIdentity,
    findLink,
    findDirectusLinkForUser,
    findAppUserIdByDirectusExternalId
} from '../auth/identityStore.js';
import { createNotification, deleteNotificationsForInviteIds } from './notifications.js';
import { isDirectusConfigured, inviteDirectusUser, findDirectusUserByEmail } from './directus.js';
import {
    CASE_COLLAB_ROLES,
    requestedCaseRole,
    getCaseCollabActorContext,
    addCaseCollaboratorAsSystem
} from './caseCollaborators.js';
import {
    INVITE_STATUS,
    getInvite,
    createInvite,
    updateInvite,
    deleteInvite,
    findOpenByEmail,
    findByTokenHash,
    expireStaleSignupInvites as expireStaleInStore
} from './caseInviteStore.js';
import { sendCaseSignupInviteEmail } from './mail.js';
import {
    ValidationError,
    ForbiddenError,
    NotFoundError,
    ConflictError
} from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDER = 'directus';

function normalizeRole(role, { allowAdmin }) {
    const requested = requestedCaseRole(role);
    return requested === CASE_COLLAB_ROLES.ADMIN && !allowAdmin ? CASE_COLLAB_ROLES.COLLABORATOR : requested;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function mintToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function expiresAtIso() {
    const days = config.caseInviteTtlDays || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function inviteUrlForToken(token) {
    const base = config.publicAppUrl || 'http://localhost:8000';
    // Query param (same pattern as ?share=) — SPA has no path router.
    return `${base}/?invite=${encodeURIComponent(token)}`;
}


/** A stored invite as the API returns it; a signup invite adds the link when its token is known. */
export function withInviteUrl(invite, { includeUrlToken = null } = {}) {
    if (!invite) return null;
    return {
        ...invite,
        ...(invite.kind === 'signup' ? { inviteUrl: includeUrlToken ? inviteUrlForToken(includeUrlToken) : null } : {})
    };
}

/**
 * Delete signup invites whose link has run out (the token stops working) and drop the notifications
 * about them, so they disappear from the People dialog.
 * @param {string|null} caseId optional case scope
 * @returns {Promise<string[]>} expired invite ids
 */
export async function expireStaleSignupInvites(caseId = null) {
    const ids = await expireStaleInStore(caseId);
    if (ids.length) {
        try {
            deleteNotificationsForInviteIds(ids);
        } catch (err) {
            console.warn('Failed to clear notifications for expired signup invites:', err.message || err);
        }
    }
    return ids;
}

async function findOpenSignupByEmail(caseId, email) {
    await expireStaleSignupInvites(caseId);
    return findOpenByEmail(caseId, email);
}

function notifyAppUserForDirectusId(directusUserId, payload) {
    try {
        const appUserId = findAppUserIdByDirectusExternalId(directusUserId);
        if (!appUserId) return null;
        return createNotification({ userId: appUserId, ...payload });
    } catch (err) {
        console.warn('Signup invite notification skipped:', err.message || err);
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
    for (const directusId of adminIds) {
        if (directusId === String(ctx.actorId)) continue;
        notifyAppUserForDirectusId(directusId, payload);
    }
}

async function activateSignupToken(inviteId) {
    const token = mintToken();
    const expiresAt = expiresAtIso();
    const invite = await updateInvite(inviteId, {
        status: INVITE_STATUS.PENDING_SIGNUP,
        token_hash: hashToken(token),
        expires_at: expiresAt
    });
    return { token, expiresAt, invite };
}

/**
 * Mint is done; try SMTP (never fail the invite — copy-link remains).
 */
async function deliverSignupInvite(invite, { email, caseTitle, proposedRole } = {}) {
    if (!invite?.inviteUrl) {
        return { emailSent: false, emailError: 'No invite URL' };
    }
    const result = await sendCaseSignupInviteEmail({
        to: email || invite.inviteeEmail,
        caseTitle: caseTitle || invite.caseTitle,
        inviteUrl: invite.inviteUrl,
        expiresAt: invite.expiresAt,
        proposedRole: proposedRole || invite.proposedRole
    });
    if (result.sent) {
        console.info('Case signup invite email sent', {
            email: email || invite.inviteeEmail,
            inviteId: invite.id,
            messageId: result.messageId
        });
    } else {
        console.info('Case signup invite email not sent (copy link still available)', {
            email: email || invite.inviteeEmail,
            inviteId: invite.id,
            reason: result.error || 'SMTP disabled'
        });
    }
    return {
        emailSent: Boolean(result.sent),
        emailError: result.sent ? null : (result.error || null)
    };
}

/**
 * Invite an email that is not yet a Directus user.
 */
export async function inviteNewEmailToCase({
    caseId,
    email,
    role,
    accessToken,
    actorDirectusUserId
}) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
        throw new ValidationError(msg('case.invite_email_required'), null, 'case.invite_email_required');
    }

    const ctx = await getCaseCollabActorContext(caseId, {
        accessToken,
        actorDirectusUserId
    });
    if (!ctx.actorCanInvite) {
        throw new ForbiddenError(msg('case.invite_forbidden'), null, 'case.invite_forbidden');
    }

    const existing = await findOpenSignupByEmail(caseId, normalized);
    if (existing) {
        throw new ConflictError(msg('case.signup_invite_pending_exists'), null, 'case.signup_invite_pending_exists');
    }

    const proposedRole = normalizeRole(role, { allowAdmin: ctx.actorIsAdmin });
    const caseTitle = ctx.caseTitle || 'a case';

    if (!ctx.actorIsAdmin) {
        const row = await createInvite({
            kind: 'signup',
            status: INVITE_STATUS.PENDING_APPROVAL,
            caseId,
            inviteeEmail: normalized,
            proposedRole,
            inviterId: actorDirectusUserId
        });
        notifyCaseAdmins(ctx, {
            type: 'case_invite_pending',
            title: `Invite pending: ${caseTitle}`,
            body: `${normalized} was invited as ${proposedRole.replace('_', ' ')} (new account). Approve in People.`,
            caseId: String(caseId),
            inviteId: row.id
        });
        return {
            status: 'pending_approval',
            invite: withInviteUrl(row),
            inviteUrl: null,
            invitee: { email: normalized, id: null }
        };
    }

    const row = await createInvite({
        kind: 'signup',
        status: INVITE_STATUS.PENDING_SIGNUP,
        caseId,
        inviteeEmail: normalized,
        proposedRole,
        inviterId: actorDirectusUserId
    });
    const { token, invite: active } = await activateSignupToken(row.id);
    const invite = withInviteUrl(active, { includeUrlToken: token });
    const delivery = await deliverSignupInvite(invite, {
        email: normalized,
        caseTitle,
        proposedRole
    });
    return {
        status: 'signup_invite',
        invite,
        inviteUrl: invite.inviteUrl,
        invitee: { email: normalized, id: null },
        emailSent: delivery.emailSent,
        emailError: delivery.emailError
    };
}

/** A signup invite in one of the given states, or a not-found error. */
async function signupInviteInStates(inviteId, states) {
    const invite = await getInvite(inviteId);
    if (!invite || invite.kind !== 'signup' || !states.includes(invite.status)) {
        throw new NotFoundError(msg('case.signup_invite_not_found'), null, 'case.signup_invite_not_found');
    }
    return invite;
}

export async function approveSignupInvite({ inviteId, accessToken, actorDirectusUserId }) {
    const row = await signupInviteInStates(inviteId, [INVITE_STATUS.PENDING_APPROVAL]);
    const ctx = await getCaseCollabActorContext(row.caseId, { accessToken, actorDirectusUserId });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_approve_admin_only'), null, 'case.invite_approve_admin_only');
    }

    const { token } = await activateSignupToken(row.id);
    const active = await updateInvite(row.id, { resolved_by: String(actorDirectusUserId) });
    const invite = withInviteUrl(active, { includeUrlToken: token });
    const delivery = await deliverSignupInvite(invite, {
        email: invite.inviteeEmail,
        caseTitle: invite.caseTitle,
        proposedRole: invite.proposedRole
    });
    return {
        status: 'signup_invite',
        invite,
        inviteUrl: invite.inviteUrl,
        emailSent: delivery.emailSent,
        emailError: delivery.emailError
    };
}

export async function rejectSignupInvite({ inviteId, accessToken, actorDirectusUserId }) {
    const row = await signupInviteInStates(inviteId, [INVITE_STATUS.PENDING_APPROVAL, INVITE_STATUS.PENDING_SIGNUP]);
    const ctx = await getCaseCollabActorContext(row.caseId, { accessToken, actorDirectusUserId });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_reject_admin_only'), null, 'case.invite_reject_admin_only');
    }
    const rejected = await updateInvite(row.id, {
        status: INVITE_STATUS.REJECTED,
        resolved_at: new Date().toISOString(),
        resolved_by: String(actorDirectusUserId),
        token_hash: null
    });
    return { status: 'rejected', invite: withInviteUrl(rejected) };
}

/** The open signup invite for a link token, expiring it (and refusing it) once its time has passed. */
async function openInviteForToken(token) {
    const row = await findByTokenHash(hashToken(token));
    if (!row || row.status !== INVITE_STATUS.PENDING_SIGNUP) {
        throw new NotFoundError(msg('case.invite_invalid_or_used'), null, 'case.invite_invalid_or_used');
    }
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < Date.now()) {
        await deleteInvite(row.id);
        throw new NotFoundError(msg('case.invite_expired'), null, 'case.invite_expired');
    }
    return row;
}

export async function getSignupInvitePreview(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) throw new ValidationError(msg('case.invite_token_required'), null, 'case.invite_token_required');
    const row = await openInviteForToken(token);
    return {
        email: row.inviteeEmail,
        caseTitle: row.caseTitle || 'a case',
        proposedRole: row.proposedRole,
        expiresAt: row.expiresAt
    };
}

/**
 * Redeem signup invite: send a Directus invite email so the user sets their own password,
 * create a local shadow row, apply case membership, and mark the invite accepted.
 * The user is NOT logged in here — they must set their password via the Directus email
 * and then log in normally.
 */
export async function acceptSignupInvite(_req, _res, {
    token: rawToken,
    username,
    firstName,
    lastName
} = {}) {
    const token = String(rawToken || '').trim();
    if (!token) throw new ValidationError(msg('case.invite_token_required'), null, 'case.invite_token_required');
    if (!isDirectusConfigured() || !config.directus.defaultRoleId) {
        throw new ValidationError(
            msg('case.signup_invite_directus_misconfigured'),
            null,
            'case.signup_invite_directus_misconfigured'
        );
    }

    const row = await openInviteForToken(token);

    const email = String(row.inviteeEmail).toLowerCase();
    let directusUser = await findDirectusUserByEmail(email);
    if (directusUser) {
        throw new ConflictError(msg('case.signup_email_exists'), null, 'case.signup_email_exists');
    }

    const baseUname = String(username || email.split('@')[0] || 'user')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 32) || `user${Date.now()}`;
    let uname = baseUname;
    let n = 0;
    while (User.findByUsername(uname) && n < 20) {
        n += 1;
        uname = `${baseUname}${n}`.slice(0, 40);
    }

    // Invite email sent by Directus; user sets their own password when they click the link
    const loginUrl = `${config.publicAppUrl || 'http://localhost:8000'}/`;
    directusUser = await inviteDirectusUser({
        email,
        roleId: config.directus.defaultRoleId,
        firstName,
        lastName,
        inviteUrl: loginUrl
    });
    const directusUserId = String(directusUser.id);

    let localUser = User.findByEmail(email);
    if (localUser) {
        const other = findDirectusLinkForUser(localUser.id);
        if (other && String(other.external_id) !== directusUserId) {
            throw new ConflictError(msg('auth.email_linked_elsewhere'), null, 'auth.email_linked_elsewhere');
        }
    } else {
        localUser = await User.createExternalShadow({ email, username: uname });
    }
    if (!findLink(PROVIDER, directusUserId)) {
        linkIdentity(localUser.id, PROVIDER, directusUserId);
    }

    // --- CUTOVER (project-case-migrate) ---
    try {
        const { applyPendingProjectCaseCollaborators } = await import('./projectCaseMigrate.js');
        await applyPendingProjectCaseCollaborators({
            appUserId: localUser.id,
            directusUserId,
            email
        });
    } catch (err) {
        console.warn(
            'CUTOVER project-case-migrate: signup pending collaborator hook failed:',
            err.message || err
        );
    }
    // --- end CUTOVER (project-case-migrate) ---

    await addCaseCollaboratorAsSystem(row.caseId, directusUserId, row.proposedRole);

    await updateInvite(row.id, {
        status: INVITE_STATUS.ACCEPTED,
        resolved_at: new Date().toISOString(),
        token_hash: null,
        accepted_user: directusUserId
    });

    return {
        status: 'invite_sent',
        email,
        caseId: row.caseId,
        caseTitle: row.caseTitle,
        role: row.proposedRole
    };
}
