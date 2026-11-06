/**
 * Collaborator management routes for Payload cases.
 *
 * Role storage: Keycloak Groups (case:{caseId}:{role}).
 * Pending invites (collaborator-submitted or admin signup invites) stored in case-invites Payload collection.
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { assertCaseAccess, getCaseRole } from '../utils/caseAccess.js';
import {
    CASE_ROLES,
    findUserByEmail,
    addUserToCaseGroup,
    removeUserFromAllCaseGroups,
    listCaseCollaborators,
    createKeycloakUser,
    sendExecuteActionsEmail,
    prepareAccountSetup,
    assignRealmRole,
    getKeycloakUser,
    getUserCaseRoleMap,
    getUsersWithRealmRole,
    kcDisplayName,
} from '../services/keycloakAdmin.js';
import {
    listGroupAccessForCase,
    setGroupAccessForCase,
    removeGroupAccessForCase,
    getCaseRoleMapFromGroups,
} from '../services/caseGroupAccess.js';
import { getGroup } from '../services/groupStore.js';
import { removeUnusedInviteeAccount } from '../services/inviteExpiry.js';
import config from '../config/index.js';

const GROUP_ID_PREFIX = 'group:';

function isGroupCollaboratorId(id) {
    return String(id || '').startsWith(GROUP_ID_PREFIX);
}

function groupIdFromCollaboratorId(id) {
    return String(id).slice(GROUP_ID_PREFIX.length);
}

/**
 * Collaborators on a case: individual Keycloak users (from case:{id}:{role}
 * groups) plus SlicerHub groups added as collaborators. Groups are shaped to
 * look like any other collaborator in the list — same id/role/display shape,
 * just `type: 'group'` and a member count instead of an email.
 */
async function buildMergedCollaborators(caseId, req) {
    const describeMembers = makeGroupMemberDescriber(req);
    const [userCollaborators, groupAccess] = await Promise.all([
        listCaseCollaborators(caseId),
        listGroupAccessForCase(caseId),
    ]);

    const groupCollaborators = await Promise.all(groupAccess.map(async (access) => {
        const group = await getGroup(access.groupId).catch(() => null);
        const { members, hiddenCount } = await describeMembers(group);
        return {
            id: `${GROUP_ID_PREFIX}${access.groupId}`,
            type: 'group',
            groupId: access.groupId,
            displayName: group?.name || 'Unknown group',
            memberCount: group?.members?.length ?? null,
            members,
            hiddenMemberCount: hiddenCount,
            role: access.role,
        };
    }));

    return [
        ...userCollaborators.map(c => ({ ...c, type: 'user' })),
        ...groupCollaborators,
    ];
}

function isPlatformAdmin(req) {
    return req.user?.role === 'admin' || req.user?.role === 'org-admin';
}

async function getPlatformAdminSubs() {
    const lists = await Promise.all(['app-org-admin', 'app-admin'].map(getUsersWithRealmRole));
    return new Set(lists.flat().map(u => u.id));
}

async function getNameSharingSubs(kcSubs) {
    if (!kcSubs.length) return new Set();
    const result = await getPayloadClient().find({
        collection: 'user-preferences',
        where: {
            and: [
                { keycloak_sub: { in: kcSubs } },
                { share_name_in_groups: { equals: true } },
            ],
        },
        limit: kcSubs.length,
        depth: 0,
    });
    return new Set(result.docs.map(d => d.keycloak_sub));
}

/**
 * Which of a group's members the viewer may see by name (hover text on the
 * group's row). Org/site admins see everyone, with email, so they can audit
 * membership; a group's own managers see everyone, as on the group page.
 * Anyone else sees only group managers, org/site admins, and members who
 * turned on "Share my name" — the rest are just counted, so a case admin
 * linking a generic group ("Students") doesn't learn every member.
 */
function makeGroupMemberDescriber(req) {
    const viewerSub = req.user.keycloakSub;
    const platformAdminViewer = isPlatformAdmin(req);
    let adminSubsPromise = null;

    return async function describeMembers(group) {
        const all = group?.members || [];
        if (!all.length) return { members: [], hiddenCount: 0 };

        let visible = all;
        const seesAll = platformAdminViewer || all.some(m => m.kcSub === viewerSub && m.canManageGroup);
        if (!seesAll) {
            adminSubsPromise ??= getPlatformAdminSubs();
            const [adminSubs, sharing] = await Promise.all([
                adminSubsPromise,
                getNameSharingSubs(all.map(m => m.kcSub)),
            ]);
            visible = all.filter(m => m.canManageGroup || adminSubs.has(m.kcSub) || sharing.has(m.kcSub));
        }

        const members = await Promise.all(visible.map(async (m) => {
            const kcUser = await getKeycloakUser(m.kcSub).catch(() => null);
            if (platformAdminViewer) {
                return { id: m.kcSub, displayName: kcUser ? kcDisplayName(kcUser) : m.kcSub, email: kcUser?.email || '' };
            }
            // Names only (preferred, then full, then username) — never email for non-admin viewers.
            return { id: m.kcSub, displayName: (kcUser && kcDisplayName({ ...kcUser, email: '' })) || 'Unnamed member' };
        }));
        return { members, hiddenCount: all.length - visible.length };
    };
}


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

function inviteExpiresAt() {
    const days = config.caseInviteTtlDays || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Keycloak account setup: a new invitee gets an enabled account that can't sign in
 * until they verify their email and choose a password, via Keycloak's own emailed link.
 * Keycloak's email is generic (it can't name the case); the case is in their list once
 * they sign in. An invite that expires unused also removes that account
 * (services/inviteExpiry.js).
 */
const ACCOUNT_SETUP_ACTIONS = ['VERIFY_EMAIL', 'UPDATE_PASSWORD'];

async function sendAccountSetupEmail(kcUserId) {
    try {
        await sendExecuteActionsEmail(kcUserId, ACCOUNT_SETUP_ACTIONS, {
            lifespanSeconds: config.caseInviteTtlDays * 24 * 60 * 60,
        });
        return { sent: true };
    } catch (err) {
        console.warn('[invites] Keycloak account-setup email failed:', err.message);
        return { sent: false, error: 'Could not send the account setup email' };
    }
}

export default function caseCollaboratorsRoutes(app) {
    const auth = [authenticateToken, requirePayload, requireKeycloak];

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
        const kcSub = req.user.keycloakSub;
        if (!kcSub) return res.json({ invites: [] });

        const [kcRoleMap, groupRoleMap] = await Promise.all([
            getUserCaseRoleMap(kcSub),
            getCaseRoleMapFromGroups(kcSub),
        ]);
        const adminCaseIds = [...new Set([
            ...Object.entries(kcRoleMap).filter(([, role]) => role === 'admin').map(([id]) => id),
            ...Object.entries(groupRoleMap).filter(([, role]) => role === 'admin').map(([id]) => id),
        ])].map(String);

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

        const describeMembers = makeGroupMemberDescriber(req);
        const groupInfoMap = {};
        await Promise.all(
            [...new Set(result.docs.filter(d => d.kind === 'group').map(d => d.group_id))]
                .map(async (groupId) => {
                    const group = await getGroup(groupId).catch(() => null);
                    const { members, hiddenCount } = await describeMembers(group);
                    groupInfoMap[groupId] = { name: group?.name || 'Unknown group', members, hiddenCount };
                })
        );

        const invites = result.docs.map(doc => ({
            id: String(doc.id),
            kind: doc.kind,
            status: doc.status,
            caseId: String(doc.case?.id ?? doc.case),
            caseTitle: doc.case?.title ?? null,
            inviteeEmail: doc.kind === 'group' ? null : doc.invitee_email,
            inviteeName: doc.kind === 'group'
                ? groupInfoMap[doc.group_id].name
                : (doc.keycloak_user_id && nameMap[doc.keycloak_user_id]) || doc.invitee_email,
            groupId: doc.kind === 'group' ? doc.group_id : null,
            groupMembers: doc.kind === 'group' ? groupInfoMap[doc.group_id].members : undefined,
            groupHiddenMemberCount: doc.kind === 'group' ? groupInfoMap[doc.group_id].hiddenCount : undefined,
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
            buildMergedCollaborators(req.params.id, req),
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

        const actorSub = req.user.keycloakSub;
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

        const describeMembers = makeGroupMemberDescriber(req);
        const invites = await Promise.all(result.docs.map(async (inv) => {
            const base = {
                id:           inv.id,
                kind:         inv.kind,
                status:       inv.status,
                proposedRole: inv.role,
            };
            if (inv.kind === 'group') {
                const group = await getGroup(inv.group_id).catch(() => null);
                const { members, hiddenCount } = await describeMembers(group);
                return {
                    ...base,
                    groupId:      inv.group_id,
                    groupName:    group?.name || 'Unknown group',
                    groupMembers: members,
                    groupHiddenMemberCount: hiddenCount,
                };
            }
            return { ...base, inviteeEmail: inv.invitee_email };
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

        const actorSub   = req.user.keycloakSub;
        const caseId     = parseInt(req.params.id, 10);
        const actorIsAdmin = (await getCaseRole(doc, req)) === 'admin';

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
            const kcUser = await createKeycloakUser({ email, requiredActions: ACCOUNT_SETUP_ACTIONS });
            // A case admin's invite is the approval: the new account may use SlicerHub.
            await assignRealmRole(kcUser.id, 'app-user');
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
                    expires_at:       inviteExpiresAt(),
                },
            });
            const emailResult = await sendAccountSetupEmail(kcUser.id);
            // No link to hand back: Keycloak's setup link only ever goes to the invitee.
            return res.status(201).json({
                status:     'signup_invite',
                emailSent:  emailResult.sent,
                emailError: emailResult.sent ? undefined : emailResult.error,
                invitee:    { email },
            });
        }

        // Known user — add directly
        await addUserToCaseGroup(user.id, req.params.id, role);
        res.status(201).json({ status: 'added', collaborator: { ...user, role } });
    }));

    /**
     * Propose a SlicerHub group as a case collaborator.
     *
     * Admin actor       → linked immediately.
     * Collaborator actor → queued as a pending_approval invite; admin must approve.
     * Once linked, access tracks the group's membership dynamically — a
     * member added or removed later needs no further review.
     */
    app.post('/api/cases/:id/group-invites', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        // Collaborators and admins can propose groups; read_only cannot
        await assertCaseAccess(doc, req, 'collaborator');

        const groupId = String(req.body?.groupId || '').trim();
        const role    = String(req.body?.role    || 'collaborator');

        if (!groupId) throw new ValidationError('Group required');
        if (!CASE_ROLES.includes(role)) {
            throw new ValidationError(`Role must be one of: ${CASE_ROLES.join(', ')}`);
        }

        const group = await getGroup(groupId);
        if (!group) throw new NotFoundError('Group not found');

        const actorSub     = req.user.keycloakSub;
        const caseId       = parseInt(req.params.id, 10);
        const actorIsAdmin = (await getCaseRole(doc, req)) === 'admin';

        // Collaborators cannot propose admin access — silently cap to collaborator.
        const effectiveRole = (!actorIsAdmin && role === 'admin') ? 'collaborator' : role;

        const alreadyLinked = await listGroupAccessForCase(req.params.id);
        if (alreadyLinked.some(g => g.groupId === groupId)) {
            return res.status(409).json({ error: { message: 'That group is already a collaborator on this case' } });
        }

        // ── Collaborator path: queue for admin approval ──────────────────────
        if (!actorIsAdmin) {
            const existing = await payload.find({
                collection: 'case-invites',
                where: {
                    case:     { equals: caseId },
                    group_id: { equals: groupId },
                    status:   { equals: 'pending_approval' },
                },
                limit: 1,
            });
            if (existing.docs.length) {
                return res.status(409).json({ error: { message: 'A request to add that group is already pending approval' } });
            }

            await payload.create({
                collection: 'case-invites',
                data: {
                    kind:       'group',
                    status:     'pending_approval',
                    inviter_id: actorSub || null,
                    case:       caseId,
                    role:       effectiveRole,
                    group_id:   groupId,
                },
            });

            return res.status(201).json({
                status: 'pending_approval',
                group:  { id: groupId, name: group.name },
            });
        }

        // ── Admin path: act immediately ──────────────────────────────────────
        await setGroupAccessForCase(req.params.id, groupId, effectiveRole);
        const collaborators = await buildMergedCollaborators(req.params.id, req);
        res.status(201).json({
            status: 'added',
            group:  { id: groupId, name: group.name },
            collaborators,
        });
    }));

    /**
     * Approve a pending invite (admin only).
     * existing kind → add user to KC group immediately.
     * signup kind   → create KC user, add to group, send invite email.
     * group kind    → link the SlicerHub group to the case.
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

        if (invite.kind === 'group') {
            const group = await getGroup(invite.group_id).catch(() => null);
            if (!group) {
                await payload.delete({ collection: 'case-invites', id: invite.id });
                return res.status(409).json({ error: { message: 'That group no longer exists' } });
            }
            await setGroupAccessForCase(caseId, invite.group_id, role);
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'accepted' } });
            return res.json({ status: 'approved', group: { id: invite.group_id, name: group.name } });
        }

        if (invite.kind === 'existing') {
            const kcUserId = invite.keycloak_user_id || (await findUserByEmail(email))?.id;
            if (!kcUserId) {
                return res.status(404).json({ error: { message: 'Could not find Keycloak account for that email' } });
            }
            await addUserToCaseGroup(kcUserId, caseId, role);
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'accepted' } });
            return res.json({ status: 'approved', collaborator: { id: kcUserId, email, role } });
        }

        // signup kind: Keycloak account setup
        let kcUser = invite.keycloak_user_id
            ? { id: invite.keycloak_user_id, email }
            : await findUserByEmail(email);
        let needsSetup = true;
        if (!kcUser) {
            kcUser = await createKeycloakUser({ email, requiredActions: ACCOUNT_SETUP_ACTIONS });
        } else {
            // Left disabled by the older invite flow → enable for setup; already active → no setup.
            needsSetup = await prepareAccountSetup(kcUser.id, ACCOUNT_SETUP_ACTIONS);
        }
        await assignRealmRole(kcUser.id, 'app-user');
        await addUserToCaseGroup(kcUser.id, caseId, role);
        if (!needsSetup) {
            await payload.update({ collection: 'case-invites', id: invite.id, data: { status: 'accepted', keycloak_user_id: kcUser.id } });
            return res.json({ status: 'approved', collaborator: { id: kcUser.id, email, role } });
        }
        await payload.update({
            collection: 'case-invites',
            id: invite.id,
            data: {
                status:           'pending_signup',
                keycloak_user_id: kcUser.id,
                expires_at:       inviteExpiresAt(),
            },
        });
        const emailResult = await sendAccountSetupEmail(kcUser.id);
        res.json({
            status:     'signup_invite',
            emailSent:  emailResult.sent,
            emailError: emailResult.sent ? undefined : emailResult.error,
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

        const wasWaitingForSignup = invite.status === 'pending_signup';
        await payload.update({
            collection: 'case-invites',
            id: invite.id,
            data: { status: 'rejected' },
        });

        // If a KC user was already added to the case group, remove them; an account made
        // only for this invite and never set up goes too (rejected first, so this invite
        // no longer counts as waiting on it).
        if (invite.keycloak_user_id && wasWaitingForSignup) {
            await removeUserFromAllCaseGroups(invite.keycloak_user_id, req.params.id).catch(() => {});
            await removeUnusedInviteeAccount(payload, invite.keycloak_user_id).catch((err) =>
                console.warn('[invites] Could not remove unused invitee account:', err.message));
        }

        res.json({ status: 'rejected' });
    }));

    /**
     * Bulk-update collaborators on a case (People dialog Save).
     * Body: { collaborators: [{ id, role }] }
     * `id` is either a Keycloak user ID, or a SlicerHub group ID prefixed
     * with "group:" (as returned by GET .../collaborators).
     * Reconciles both Keycloak groups (individual users) and case-group-access
     * records (SlicerHub groups):
     *   - Entries in the new list get their role set.
     *   - Entries not in the new list are removed.
     * Access: case admin only.
     */
    app.put('/api/cases/:id/collaborators', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        const incoming = req.body?.collaborators;
        if (!Array.isArray(incoming)) throw new ValidationError('collaborators must be an array');

        const userEntries = [];
        const groupEntries = [];
        for (const entry of incoming) {
            if (!entry.id) throw new ValidationError('Each collaborator must have an id');
            if (!CASE_ROLES.includes(entry.role)) {
                throw new ValidationError(`Invalid role "${entry.role}". Must be one of: ${CASE_ROLES.join(', ')}`);
            }
            if (isGroupCollaboratorId(entry.id)) {
                groupEntries.push({ groupId: groupIdFromCollaboratorId(entry.id), role: entry.role });
            } else {
                userEntries.push({ id: String(entry.id), role: entry.role });
            }
        }

        // Groups must exist before we link them to the case
        const currentGroups = await listGroupAccessForCase(req.params.id);
        for (const entry of groupEntries) {
            const group = await getGroup(entry.groupId);
            if (!group) throw new ValidationError(`Group not found: ${entry.groupId}`);
        }

        // ── Reconcile individual Keycloak-group collaborators ────────────────
        const currentUsers = await listCaseCollaborators(req.params.id);
        const incomingUserIds = new Set(userEntries.map(c => c.id));

        for (const c of currentUsers) {
            if (!incomingUserIds.has(c.id)) {
                await removeUserFromAllCaseGroups(c.id, req.params.id);
            }
        }
        for (const entry of userEntries) {
            const existing = currentUsers.find(c => c.id === entry.id);
            if (!existing || existing.role !== entry.role) {
                await addUserToCaseGroup(entry.id, req.params.id, entry.role);
            }
        }

        // ── Reconcile SlicerHub group collaborators ──────────────────────────
        const incomingGroupIds = new Set(groupEntries.map(g => g.groupId));

        for (const g of currentGroups) {
            if (!incomingGroupIds.has(g.groupId)) {
                await removeGroupAccessForCase(req.params.id, g.groupId);
            }
        }
        for (const entry of groupEntries) {
            const existing = currentGroups.find(g => g.groupId === entry.groupId);
            if (!existing || existing.role !== entry.role) {
                await setGroupAccessForCase(req.params.id, entry.groupId, entry.role);
            }
        }

        const updated = await buildMergedCollaborators(req.params.id, req);
        res.json({ collaborators: updated });
    }));

    /**
     * Remove a single collaborator from a case — either an individual
     * (Keycloak user ID) or a SlicerHub group ("group:{id}").
     * Access: case admin only.
     */
    app.delete('/api/cases/:id/collaborators/:collaboratorId', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        const { collaboratorId } = req.params;
        if (isGroupCollaboratorId(collaboratorId)) {
            await removeGroupAccessForCase(req.params.id, groupIdFromCollaboratorId(collaboratorId));
        } else {
            await removeUserFromAllCaseGroups(collaboratorId, req.params.id);
        }
        res.status(204).end();
    }));
}
