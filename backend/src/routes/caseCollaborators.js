/**
 * Collaborator management routes for Payload cases.
 *
 * Role storage: Keycloak Groups (case:{caseId}:{role}).
 * Pending invites (collaborator-submitted or admin signup invites) stored in case-invites Payload collection.
 */

import crypto from 'crypto';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { assertCaseAccess } from '../utils/caseAccess.js';
import {
    CASE_ROLES,
    findUserByEmail,
    addUserToCaseGroup,
    removeUserFromAllCaseGroups,
    listCaseCollaborators,
    createKeycloakUser,
    setKeycloakUserPassword,
    enableKeycloakUser,
    getKeycloakSubForUser,
    getUserCaseRole,
    getKeycloakUser,
    getUserCaseRoleMap,
    kcDisplayName,
} from '../services/keycloakAdmin.js';
import { sendCaseSignupInviteEmail } from '../services/mail.js';
import config from '../config/index.js';

function requirePayload(req, res, next) {
    if (!getPayloadClient()) {
        return res.status(503).json({
            error: { message: 'Cases service not available' }
        });
    }
    next();
}

function requireKeycloak(req, res, next) {
    if (config.auth.provider !== 'keycloak') {
        return res.status(503).json({
            error: { message: 'Collaborator management requires Keycloak (AUTH_PROVIDER=keycloak)' }
        });
    }
    next();
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function mintToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function inviteExpiresAt() {
    const days = config.caseInviteTtlDays || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function kcInviteUrl(token) {
    const base = (config.publicAppUrl || 'http://localhost:8000').replace(/\/+$/, '');
    return `${base}/?kc-invite=${encodeURIComponent(token)}`;
}

export default function caseCollaboratorsRoutes(app) {
    const auth = [authenticateToken, requirePayload, requireKeycloak];

    /**
     * Preview a Keycloak signup invite by token (public — invitee is not logged in yet).
     * Returns: { email, caseTitle, caseId, role, expiresAt }
     */
    app.get('/api/cases/invites/preview', asyncHandler(async (req, res) => {
        const token = String(req.query.token || '').trim();
        if (!token) throw new ValidationError('Token required');

        const payload = getPayloadClient();
        if (!payload) {
            return res.status(503).json({ error: { message: 'Cases service not available' } });
        }

        const tokenHash = hashToken(token);
        const result = await payload.find({
            collection: 'case-invites',
            where: {
                token_hash: { equals: tokenHash },
                status:     { equals: 'pending_signup' },
            },
            depth: 0,
            limit: 1,
        });

        const invite = result.docs[0];
        if (!invite) {
            return res.status(404).json({ error: { message: 'Invite not found or already used' } });
        }
        if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'expired' } });
            return res.status(410).json({ error: { message: 'This invite link has expired' } });
        }

        const caseId = invite.case?.id ?? invite.case;
        const caseDoc = await payload.findByID({ collection: 'cases', id: caseId });
        res.json({
            email:      invite.invitee_email,
            caseTitle:  caseDoc?.title || 'a case',
            caseId,
            role:       invite.role,
            expiresAt:  invite.expires_at,
        });
    }));

    /**
     * Redeem a Keycloak signup invite (public — invitee is not logged in yet).
     * Body: { token, firstName?, lastName?, password }
     * Sets the Keycloak user's password and enables the account.
     */
    app.post('/api/cases/invites/redeem', asyncHandler(async (req, res) => {
        const token     = String(req.body?.token    || '').trim();
        const password  = String(req.body?.password || '').trim();
        const firstName = String(req.body?.firstName || '').trim() || undefined;
        const lastName  = String(req.body?.lastName  || '').trim() || undefined;

        if (!token)    throw new ValidationError('Token required');
        if (!password || password.length < 8) throw new ValidationError('Password must be at least 8 characters');

        const payload = getPayloadClient();
        if (!payload) {
            return res.status(503).json({ error: { message: 'Cases service not available' } });
        }

        const tokenHash = hashToken(token);
        const result = await payload.find({
            collection: 'case-invites',
            where: {
                token_hash: { equals: tokenHash },
                status:     { equals: 'pending_signup' },
            },
            depth: 0,
            limit: 1,
        });

        const invite = result.docs[0];
        if (!invite) {
            return res.status(404).json({ error: { message: 'Invite not found or already used' } });
        }
        if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'expired' } });
            return res.status(410).json({ error: { message: 'This invite link has expired' } });
        }

        await setKeycloakUserPassword(invite.keycloak_user_id, password);
        await enableKeycloakUser(invite.keycloak_user_id, { firstName, lastName });
        await payload.update({
            collection: 'case-invites',
            id: invite.id,
            data: { status: 'accepted' },
        });

        const caseId = invite.case?.id ?? invite.case;
        res.json({ status: 'accepted', email: invite.invitee_email, caseId });
    }));

    /**
     * Look up a Keycloak user by email (for the invite dialog search).
     * Returns basic profile if found, 404 if no account with that email.
     */
    app.get('/api/cases/lookup-user', ...auth, asyncHandler(async (req, res) => {
        const email = String(req.query.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
            throw new ValidationError('Valid email required');
        }

        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(404).json({ error: { message: 'No account found with that email address' } });
        }

        res.json({ user });
    }));

    /**
     * Count pending invites across all cases for the current user.
     * Org-admins and site-admins see all pending_approval invites.
     * Everyone else gets 0 (case-level admin scoping is a future enhancement).
     */
    app.get('/api/cases/invites/pending-count', ...auth, asyncHandler(async (req, res) => {
        const isAdmin = req.user?.role === 'admin' || req.user?.role === 'org-admin';
        if (!isAdmin) {
            res.set('Cache-Control', 'no-store');
            return res.json({ count: 0 });
        }
        const payload = getPayloadClient();
        const result = await payload.find({
            collection: 'case-invites',
            where: { status: { equals: 'pending_approval' } },
            limit: 0,
        });
        res.set('Cache-Control', 'no-store');
        res.json({ count: result.totalDocs });
    }));

    /**
     * All pending_approval invites across cases where the current user is an admin.
     * Keycloak path: replaces /api/directus/invites/pending-approval for KC users.
     */
    app.get('/api/cases/invites/pending-approval', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const kcSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        if (!kcSub) return res.json({ invites: [] });

        const roleMap = await getUserCaseRoleMap(kcSub);
        const adminCaseIds = Object.entries(roleMap)
            .filter(([, role]) => role === 'admin')
            .map(([id]) => String(id));

        const ownedResult = await payload.find({
            collection: 'cases',
            where: { owner_id: { equals: kcSub } },
            limit: 200,
            depth: 0,
        });
        const allAdminIds = [...new Set([...adminCaseIds, ...ownedResult.docs.map(d => String(d.id))])];
        if (!allAdminIds.length) return res.json({ invites: [] });

        const result = await payload.find({
            collection: 'case-invites',
            where: {
                and: [
                    { case: { in: allAdminIds } },
                    { status: { equals: 'pending_approval' } },
                ],
            },
            sort: '-createdAt',
            limit: 100,
            depth: 1,
        });

        // Resolve display names for inviters and (if KC user) invitees
        const subs = [...new Set([
            ...result.docs.map(d => d.inviter_id),
            ...result.docs.map(d => d.keycloak_user_id),
        ].filter(Boolean))];
        const nameMap = {};
        await Promise.all(subs.map(async (sub) => {
            const user = await getKeycloakUser(sub);
            if (user) nameMap[sub] = kcDisplayName(user) || null;
        }));

        const invites = result.docs.map(doc => ({
            id: String(doc.id),
            kind: doc.kind,
            status: doc.status,
            caseId: String(doc.case?.id ?? doc.case),
            caseTitle: doc.case?.title ?? null,
            inviteeEmail: doc.invitee_email,
            inviteeName: (doc.keycloak_user_id && nameMap[doc.keycloak_user_id]) || doc.invitee_email,
            inviterName: (doc.inviter_id && nameMap[doc.inviter_id]) || null,
            proposedRole: doc.role,
            createdAt: doc.createdAt,
        }));

        res.set('Cache-Control', 'no-store');
        res.json({ invites });
    }));

    /**
     * List all collaborators on a case.
     * Readable by any collaborator (including read_only).
     */
    app.get('/api/cases/:id/collaborators', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'read_only');

        const [collaborators, ownerKc] = await Promise.all([
            listCaseCollaborators(req.params.id),
            doc.owner_id ? getKeycloakUser(doc.owner_id).catch(() => null) : Promise.resolve(null),
        ]);

        const owner = ownerKc ? {
            id:          doc.owner_id,
            email:       ownerKc.email       || '',
            firstName:   ownerKc.firstName   || '',
            lastName:    ownerKc.lastName    || '',
            preferredName: ownerKc.preferredName || '',
            displayName: ownerKc.displayName || '',
            avatarUrl:   `/api/users/${encodeURIComponent(doc.owner_id)}/avatar`,
        } : null;

        res.set('Cache-Control', 'no-store');
        res.json({ collaborators, owner });
    }));

    /**
     * List pending invites for a case.
     * Admins see all pending; collaborators see only the ones they submitted.
     */
    app.get('/api/cases/:id/invites', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        const myRole = await assertCaseAccess(doc, req, 'read_only');
        const effectiveAdmin = myRole === 'admin';

        const actorSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        const caseId   = parseInt(req.params.id, 10);

        const where = {
            and: [
                { case: { equals: caseId } },
                {
                    or: [
                        { status: { equals: 'pending_approval' } },
                        { status: { equals: 'pending_signup' } },
                    ],
                },
                ...((!effectiveAdmin && actorSub)
                    ? [{ inviter_id: { equals: actorSub } }]
                    : []),
            ],
        };

        const result = await payload.find({
            collection: 'case-invites',
            where,
            limit: 200,
            sort: 'createdAt',
        });

        const invites = result.docs.map(inv => ({
            id:           inv.id,
            kind:         inv.kind,
            status:       inv.status,
            inviteeEmail: inv.invitee_email,
            proposedRole: inv.role,
        }));

        res.set('Cache-Control', 'no-store');
        res.json({ invites });
    }));

    /**
     * Invite a user to a case by email.
     *
     * Admin actor + existing KC user → direct add to KC group.
     * Admin actor + unknown email   → create disabled KC user + send signup invite email.
     * Collaborator actor            → create a pending_approval invite record; admin must approve.
     */
    app.post('/api/cases/:id/invites', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        // Collaborators and admins can submit invites; read_only cannot
        await assertCaseAccess(doc, req, 'collaborator');

        const email = String(req.body?.email || '').trim().toLowerCase();
        const role  = String(req.body?.role  || 'collaborator');

        if (!email || !email.includes('@')) throw new ValidationError('Valid email required');
        if (!CASE_ROLES.includes(role)) {
            throw new ValidationError(`Role must be one of: ${CASE_ROLES.join(', ')}`);
        }

        const actorSub   = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        const caseId     = parseInt(req.params.id, 10);
        const sysAdmin   = req.user.role === 'admin';
        const caseOwner  = actorSub && doc.owner_id === actorSub;
        const kcRole     = (!sysAdmin && !caseOwner && actorSub)
            ? await getUserCaseRole(actorSub, caseId)
            : null;
        const actorIsAdmin = sysAdmin || caseOwner || kcRole === 'admin';

        // Collaborators cannot propose admin access — silently cap to collaborator.
        const effectiveRole = (!actorIsAdmin && role === 'admin') ? 'collaborator' : role;

        const user = await findUserByEmail(email);

        // Prevent adding the owner as a collaborator
        if (user && doc.owner_id && doc.owner_id === user.id) {
            return res.status(409).json({
                error: { message: 'The case owner already has admin access' }
            });
        }

        // ── Collaborator path: queue for admin approval ──────────────────────
        if (!actorIsAdmin) {
            const existing = await payload.find({
                collection: 'case-invites',
                where: {
                    case:          { equals: caseId },
                    invitee_email: { equals: email },
                    or: [
                        { status: { equals: 'pending_approval' } },
                        { status: { equals: 'pending_signup'   } },
                    ],
                },
                limit: 1,
            });
            if (existing.docs.length) {
                return res.status(409).json({ error: { message: 'An invite for that email is already pending approval' } });
            }

            await payload.create({
                collection: 'case-invites',
                data: {
                    kind:          user ? 'existing' : 'signup',
                    status:        'pending_approval',
                    invitee_email: email,
                    inviter_id:    actorSub || null,
                    case:          caseId,
                    role:          effectiveRole,
                    keycloak_user_id: user?.id || null,
                },
            });

            return res.status(201).json({
                status:  'pending_approval',
                invitee: { email },
            });
        }

        // ── Admin path: act immediately ──────────────────────────────────────
        if (!user) {
            // Unknown email — create a disabled KC account, add to group, send invite email
            const kcUser    = await createKeycloakUser({ email });
            const token     = mintToken();
            const expiresAt = inviteExpiresAt();

            await addUserToCaseGroup(kcUser.id, req.params.id, role);
            await payload.create({
                collection: 'case-invites',
                data: {
                    kind:             'signup',
                    status:           'pending_signup',
                    invitee_email:    email,
                    inviter_id:       actorSub || null,
                    case:             caseId,
                    role,
                    keycloak_user_id: kcUser.id,
                    token_hash:       hashToken(token),
                    expires_at:       expiresAt,
                },
            });

            const inviteUrl   = kcInviteUrl(token);
            const emailResult = await sendCaseSignupInviteEmail({
                to:           email,
                caseTitle:    doc.title,
                inviteUrl,
                expiresAt,
                proposedRole: role,
            });

            return res.status(201).json({
                status:     'signup_invite',
                emailSent:  emailResult.sent,
                emailError: emailResult.sent ? undefined : emailResult.error,
                inviteUrl,
                invitee:    { email },
            });
        }

        // Known user — add directly
        await addUserToCaseGroup(user.id, req.params.id, role);
        res.status(201).json({ status: 'added', collaborator: { ...user, role } });
    }));

    /**
     * Approve a pending invite (admin only).
     * existing kind → add user to KC group immediately.
     * signup kind   → create KC user, add to group, send invite email.
     */
    app.post('/api/cases/:id/invites/:inviteId/approve', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'admin');

        const invite = await payload.findByID({ collection: 'case-invites', id: req.params.inviteId });
        if (!invite || String(invite.case?.id ?? invite.case) !== String(req.params.id)) {
            throw new NotFoundError('Invite not found');
        }
        if (invite.status !== 'pending_approval') {
            return res.status(409).json({ error: { message: 'Invite is not pending approval' } });
        }

        const email = invite.invitee_email;
        const role  = invite.role;
        const caseId = req.params.id;

        if (invite.kind === 'existing') {
            const kcUserId = invite.keycloak_user_id || (await findUserByEmail(email))?.id;
            if (!kcUserId) {
                return res.status(404).json({ error: { message: 'Could not find Keycloak account for that email' } });
            }
            await addUserToCaseGroup(kcUserId, caseId, role);
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'accepted' } });
            return res.json({ status: 'approved', collaborator: { id: kcUserId, email, role } });
        }

        // signup kind — create KC user if needed, then send invite email
        let kcUser = invite.keycloak_user_id
            ? { id: invite.keycloak_user_id, email }
            : await findUserByEmail(email);
        if (!kcUser) {
            kcUser = await createKeycloakUser({ email });
        }

        const token     = mintToken();
        const expiresAt = inviteExpiresAt();
        await addUserToCaseGroup(kcUser.id, caseId, role);
        await payload.update({
            collection: 'case-invites',
            id: invite.id,
            data: {
                status:           'pending_signup',
                keycloak_user_id: kcUser.id,
                token_hash:       hashToken(token),
                expires_at:       expiresAt,
            },
        });

        const inviteUrl   = kcInviteUrl(token);
        const emailResult = await sendCaseSignupInviteEmail({
            to:           email,
            caseTitle:    doc.title,
            inviteUrl,
            expiresAt,
            proposedRole: role,
        });

        res.json({
            status:     'signup_invite',
            emailSent:  emailResult.sent,
            emailError: emailResult.sent ? undefined : emailResult.error,
            inviteUrl,
        });
    }));

    /**
     * Reject a pending invite (admin only).
     */
    app.post('/api/cases/:id/invites/:inviteId/reject', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        await assertCaseAccess(doc, req, 'admin');

        const invite = await payload.findByID({ collection: 'case-invites', id: req.params.inviteId });
        if (!invite || String(invite.case?.id ?? invite.case) !== String(req.params.id)) {
            throw new NotFoundError('Invite not found');
        }
        if (!['pending_approval', 'pending_signup'].includes(invite.status)) {
            return res.status(409).json({ error: { message: 'Invite cannot be rejected in its current state' } });
        }

        // If a KC user was already added to the case group, remove them
        if (invite.keycloak_user_id && invite.status === 'pending_signup') {
            await removeUserFromAllCaseGroups(invite.keycloak_user_id, req.params.id).catch(() => {});
        }

        await payload.update({
            collection: 'case-invites',
            id: invite.id,
            data: { status: 'rejected', token_hash: null },
        });

        res.json({ status: 'rejected' });
    }));

    /**
     * Bulk-update collaborators on a case (People dialog Save).
     * Body: { collaborators: [{ id: keycloakUserId, role }] }
     * Reconciles Keycloak groups:
     *   - Users in the new list get their role set.
     *   - Users not in the new list are removed from all case groups.
     * Access: case admin only.
     */
    app.put('/api/cases/:id/collaborators', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        const incoming = req.body?.collaborators;
        if (!Array.isArray(incoming)) throw new ValidationError('collaborators must be an array');

        // Validate all entries before making any changes
        for (const entry of incoming) {
            if (!entry.id) throw new ValidationError('Each collaborator must have an id (Keycloak user ID)');
            if (!CASE_ROLES.includes(entry.role)) {
                throw new ValidationError(`Invalid role "${entry.role}". Must be one of: ${CASE_ROLES.join(', ')}`);
            }
        }

        const current = await listCaseCollaborators(req.params.id);
        const incomingIds = new Set(incoming.map(c => c.id));
        const currentIds  = new Set(current.map(c => c.id));

        // Remove collaborators no longer in the list
        for (const c of current) {
            if (!incomingIds.has(c.id)) {
                await removeUserFromAllCaseGroups(c.id, req.params.id);
            }
        }

        // Add or update roles for everyone in the new list
        for (const entry of incoming) {
            const existing = current.find(c => c.id === entry.id);
            if (!existing || existing.role !== entry.role) {
                await addUserToCaseGroup(entry.id, req.params.id, entry.role);
            }
        }

        const updated = await listCaseCollaborators(req.params.id);
        res.json({ collaborators: updated });
    }));

    /**
     * Remove a single collaborator from a case.
     * Access: case admin only.
     */
    app.delete('/api/cases/:id/collaborators/:keycloakUserId', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        await removeUserFromAllCaseGroups(req.params.keycloakUserId, req.params.id);
        res.status(204).end();
    }));
}
