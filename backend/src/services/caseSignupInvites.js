/**
 * Case signup invites for emails that are not yet Directus users.
 * No Directus account until the invitee redeems an unexpired, single-use link.
 */

import crypto from 'crypto';
import db from '../db/database.js';
import config from '../config/index.js';
import User from '../models/User.js';
import {
    linkIdentity,
    findLink,
    findDirectusLinkForUser,
    findAppUserIdByDirectusExternalId,
    storeProviderTokens
} from '../auth/identityStore.js';
import { issueAppSession } from '../auth/session.js';
import { setDirectusLinkCookie } from '../auth/directusLinkCookie.js';
import { createNotification, deleteNotificationsForInviteIds } from './notifications.js';
import {
    CASE_COLLAB_ROLES,
    isDirectusConfigured,
    createDirectusUser,
    findDirectusUserByEmail,
    getCaseCollabActorContext,
    addCaseCollaboratorAsSystem
} from './directus.js';
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
    const raw = String(role || '').trim().toLowerCase().replace(/-/g, '_');
    if (raw === CASE_COLLAB_ROLES.ADMIN || raw === 'admin') {
        return allowAdmin ? CASE_COLLAB_ROLES.ADMIN : CASE_COLLAB_ROLES.COLLABORATOR;
    }
    if (
        raw === CASE_COLLAB_ROLES.READ_ONLY
        || raw === 'readonly'
        || raw === 'observer'
        || raw === 'read'
    ) {
        return CASE_COLLAB_ROLES.READ_ONLY;
    }
    return CASE_COLLAB_ROLES.COLLABORATOR;
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

async function loginDirectusWithPassword(email, password) {
    const base = (config.directus.url || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new ValidationError(msg('directus.not_configured'), null, 'directus.not_configured');
    }
    const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({
            email: String(email).toLowerCase(),
            password: String(password)
        })
    });
    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }
    if (!res.ok) {
        const msg = body?.errors?.[0]?.message || body?.message || 'Could not sign in to Directus after account create';
        throw new ValidationError(msg);
    }
    const data = body?.data || body;
    const accessToken = data?.access_token;
    if (!accessToken) {
        throw new ValidationError(msg('directus.login_no_session'), null, 'directus.login_no_session');
    }
    return {
        accessToken,
        refreshToken: data?.refresh_token || null,
        expires: data?.expires,
        expiresAt: data?.expires
            ? new Date(Date.now() + Number(data.expires)).toISOString()
            : null
    };
}

function mapSignupInvite(row, { includeUrlToken = null } = {}) {
    if (!row) return null;
    const expired = row.expires_at
        && new Date(row.expires_at).getTime() < Date.now()
        && row.status === 'pending_signup';
    return {
        id: row.id,
        kind: 'signup',
        caseId: row.case_id,
        caseTitle: row.case_title || null,
        inviteeEmail: row.invitee_email,
        proposedRole: row.proposed_role,
        inviterDirectusUserId: row.inviter_directus_user_id,
        status: expired ? 'expired' : row.status,
        expiresAt: row.expires_at || null,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at || null,
        inviteUrl: includeUrlToken ? inviteUrlForToken(includeUrlToken) : null
    };
}

/**
 * Mark overdue pending_signup invites as expired, invalidate tokens, and drop
 * related in-app notifications so they disappear from the People dialog.
 * @param {string|null} caseId optional case scope
 * @returns {number[]} expired invite ids
 */
export function expireStaleSignupInvites(caseId = null) {
    const caseKey = caseId != null ? String(caseId).trim() : '';
    const nowIso = new Date().toISOString();
    const stale = caseKey
        ? db.prepare(`
            SELECT id FROM case_signup_invites
            WHERE case_id = ?
              AND status = 'pending_signup'
              AND expires_at IS NOT NULL
              AND expires_at < ?
          `).all(caseKey, nowIso)
        : db.prepare(`
            SELECT id FROM case_signup_invites
            WHERE status = 'pending_signup'
              AND expires_at IS NOT NULL
              AND expires_at < ?
          `).all(nowIso);

    if (!stale.length) return [];

    const ids = stale.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`
        UPDATE case_signup_invites
        SET status = 'expired',
            token_hash = NULL,
            resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)
        WHERE id IN (${placeholders})
    `).run(...ids);

    try {
        deleteNotificationsForInviteIds(ids);
    } catch (err) {
        console.warn('Failed to clear notifications for expired signup invites:', err.message || err);
    }
    return ids;
}

export function listSignupInvitesForCase(caseId) {
    const caseKey = String(caseId || '').trim();
    if (!caseKey) return [];
    expireStaleSignupInvites(caseKey);
    return db.prepare(`
        SELECT * FROM case_signup_invites
        WHERE case_id = ?
          AND status IN ('pending_signup', 'pending_approval')
        ORDER BY created_at DESC
    `).all(caseKey).map((row) => mapSignupInvite(row));
}

function getSignupRowById(id) {
    return db.prepare('SELECT * FROM case_signup_invites WHERE id = ?').get(Number(id)) || null;
}

function findOpenSignupByEmail(caseId, email) {
    expireStaleSignupInvites(caseId);
    return db.prepare(`
        SELECT * FROM case_signup_invites
        WHERE case_id = ?
          AND invitee_email = ?
          AND status IN ('pending_signup', 'pending_approval')
        LIMIT 1
    `).get(String(caseId), String(email).toLowerCase()) || null;
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
    if (ctx.ownerId) adminIds.add(String(ctx.ownerId));
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

function insertSignupInvite({
    caseId,
    caseTitle,
    inviteeEmail,
    proposedRole,
    inviterDirectusUserId,
    inviterAppUserId,
    status,
    tokenHash = null,
    expiresAt = null
}) {
    const result = db.prepare(`
        INSERT INTO case_signup_invites (
            case_id, case_title, invitee_email, proposed_role,
            inviter_directus_user_id, inviter_app_user_id,
            token_hash, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(caseId),
        caseTitle || null,
        String(inviteeEmail).toLowerCase(),
        proposedRole,
        String(inviterDirectusUserId),
        inviterAppUserId != null ? Number(inviterAppUserId) : null,
        tokenHash,
        expiresAt,
        status
    );
    return getSignupRowById(result.lastInsertRowid);
}

function activateSignupToken(rowId) {
    const token = mintToken();
    const expiresAt = expiresAtIso();
    db.prepare(`
        UPDATE case_signup_invites
        SET status = 'pending_signup',
            token_hash = ?,
            expires_at = ?
        WHERE id = ?
    `).run(hashToken(token), expiresAt, Number(rowId));
    return { token, expiresAt, row: getSignupRowById(rowId) };
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
    actorDirectusUserId,
    actorAppUserId = null
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

    const existing = findOpenSignupByEmail(caseId, normalized);
    if (existing) {
        throw new ConflictError(msg('case.signup_invite_pending_exists'), null, 'case.signup_invite_pending_exists');
    }

    const proposedRole = normalizeRole(role, { allowAdmin: ctx.actorIsAdmin });
    const caseTitle = ctx.caseTitle || 'a case';

    if (!ctx.actorIsAdmin) {
        const row = insertSignupInvite({
            caseId,
            caseTitle,
            inviteeEmail: normalized,
            proposedRole,
            inviterDirectusUserId: actorDirectusUserId,
            inviterAppUserId: actorAppUserId,
            status: 'pending_approval'
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
            invite: mapSignupInvite(row),
            inviteUrl: null,
            invitee: { email: normalized, id: null }
        };
    }

    const row = insertSignupInvite({
        caseId,
        caseTitle,
        inviteeEmail: normalized,
        proposedRole,
        inviterDirectusUserId: actorDirectusUserId,
        inviterAppUserId: actorAppUserId,
        status: 'pending_signup'
    });
    const { token, row: active } = activateSignupToken(row.id);
    const invite = mapSignupInvite(active, { includeUrlToken: token });
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

export async function approveSignupInvite({
    inviteId,
    accessToken,
    actorDirectusUserId
}) {
    const row = getSignupRowById(inviteId);
    if (!row || row.status !== 'pending_approval') {
        throw new NotFoundError(msg('case.signup_invite_not_found'), null, 'case.signup_invite_not_found');
    }
    const ctx = await getCaseCollabActorContext(row.case_id, {
        accessToken,
        actorDirectusUserId
    });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_approve_admin_only'), null, 'case.invite_approve_admin_only');
    }

    const { token, row: active } = activateSignupToken(row.id);
    db.prepare(`
        UPDATE case_signup_invites
        SET resolved_by_directus_user_id = ?
        WHERE id = ?
    `).run(String(actorDirectusUserId), row.id);

    const invite = mapSignupInvite(getSignupRowById(active.id), { includeUrlToken: token });
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

export async function rejectSignupInvite({
    inviteId,
    accessToken,
    actorDirectusUserId
}) {
    const row = getSignupRowById(inviteId);
    if (!row || !['pending_approval', 'pending_signup'].includes(row.status)) {
        throw new NotFoundError(msg('case.signup_invite_not_found'), null, 'case.signup_invite_not_found');
    }
    const ctx = await getCaseCollabActorContext(row.case_id, {
        accessToken,
        actorDirectusUserId
    });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.invite_reject_admin_only'), null, 'case.invite_reject_admin_only');
    }
    db.prepare(`
        UPDATE case_signup_invites
        SET status = 'cancelled',
            resolved_at = CURRENT_TIMESTAMP,
            resolved_by_directus_user_id = ?,
            token_hash = NULL
        WHERE id = ?
    `).run(String(actorDirectusUserId), row.id);
    return { status: 'cancelled', invite: mapSignupInvite(getSignupRowById(row.id)) };
}

export function getSignupInvitePreview(rawToken) {
    const token = String(rawToken || '').trim();
    if (!token) throw new ValidationError(msg('case.invite_token_required'), null, 'case.invite_token_required');
    const row = db.prepare(`
        SELECT * FROM case_signup_invites WHERE token_hash = ? LIMIT 1
    `).get(hashToken(token));
    if (!row || row.status !== 'pending_signup') {
        throw new NotFoundError(msg('case.invite_invalid_or_used'), null, 'case.invite_invalid_or_used');
    }
    if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare(`
            UPDATE case_signup_invites SET status = 'expired', token_hash = NULL WHERE id = ?
        `).run(row.id);
        throw new NotFoundError(msg('case.invite_expired'), null, 'case.invite_expired');
    }
    return {
        email: row.invitee_email,
        caseTitle: row.case_title || 'a case',
        proposedRole: row.proposed_role,
        expiresAt: row.expires_at
    };
}

/**
 * Redeem signup invite: create Directus + local user, apply membership, issue session.
 */
export async function acceptSignupInvite(req, res, {
    token: rawToken,
    password,
    username,
    firstName,
    lastName,
    theme
} = {}) {
    const token = String(rawToken || '').trim();
    if (!token) throw new ValidationError(msg('case.invite_token_required'), null, 'case.invite_token_required');
    if (!password || String(password).length < 8) {
        throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
    }
    if (!isDirectusConfigured() || !config.directus.defaultRoleId) {
        throw new ValidationError(
            msg('case.signup_invite_directus_misconfigured'),
            null,
            'case.signup_invite_directus_misconfigured'
        );
    }

    const row = db.prepare(`
        SELECT * FROM case_signup_invites WHERE token_hash = ? LIMIT 1
    `).get(hashToken(token));
    if (!row || row.status !== 'pending_signup') {
        throw new NotFoundError(msg('case.invite_invalid_or_used'), null, 'case.invite_invalid_or_used');
    }
    if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare(`
            UPDATE case_signup_invites SET status = 'expired', token_hash = NULL WHERE id = ?
        `).run(row.id);
        throw new NotFoundError(msg('case.invite_expired'), null, 'case.invite_expired');
    }

    const email = String(row.invitee_email).toLowerCase();
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

    directusUser = await createDirectusUser({
        email,
        password: String(password),
        roleId: config.directus.defaultRoleId,
        firstName,
        lastName
    });
    const directusUserId = String(directusUser.id);

    let localUser = User.findByEmail(email);
    if (localUser) {
        const other = findDirectusLinkForUser(localUser.id);
        if (other && String(other.external_id) !== directusUserId) {
            throw new ConflictError(msg('auth.email_linked_elsewhere'), null, 'auth.email_linked_elsewhere');
        }
    } else {
        localUser = await User.create({
            username: uname,
            email,
            password: String(password),
            preferences: (theme === 'dark' || theme === 'light') ? { theme } : {}
        });
    }
    if (!findLink(PROVIDER, directusUserId)) {
        linkIdentity(localUser.id, PROVIDER, directusUserId);
    }

    await addCaseCollaboratorAsSystem(
        row.case_id,
        directusUserId,
        row.proposed_role
    );

    db.prepare(`
        UPDATE case_signup_invites
        SET status = 'accepted',
            resolved_at = CURRENT_TIMESTAMP,
            token_hash = NULL,
            accepted_directus_user_id = ?
        WHERE id = ?
    `).run(directusUserId, row.id);

    const externalTokens = await loginDirectusWithPassword(email, password);
    const { user: sessionUser, sessionPayload } = issueAppSession(req, res, {
        ...localUser,
        firstName: firstName || null,
        lastName: lastName || null
    });
    if (config.auth?.storeProviderTokens && sessionPayload?.jti) {
        storeProviderTokens(sessionPayload.jti, localUser.id, PROVIDER, externalTokens);
        setDirectusLinkCookie(res, {
            userId: localUser.id,
            accessToken: externalTokens.accessToken,
            refreshToken: externalTokens.refreshToken,
            expiresAt: externalTokens.expiresAt,
            expires: externalTokens.expires
        });
    }

    return {
        status: 'accepted',
        user: sessionUser,
        caseId: row.case_id,
        caseTitle: row.case_title,
        role: row.proposed_role
    };
}
