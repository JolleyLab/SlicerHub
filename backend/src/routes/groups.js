import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole } from '../auth/requireRole.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import config from '../config/index.js';
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { getPayloadClient } from '../payload/index.js';
import { findUserByEmail, getKeycloakUser, kcDisplayName, getKeycloakSubForUser } from '../services/keycloakAdmin.js';
import { CAPABILITIES } from '../services/groupCapabilities.js';
import {
    listGroups,
    getGroup,
    createGroup,
    updateGroup,
    deleteGroup,
    addGroupMember,
    removeGroupMember,
    updateGroupMember,
    getGroupMemberById,
    getGroupsForUser,
} from '../services/groupStore.js';

const requireOrgAdmin = [requireRole('org-admin')];

function getCallerKcSub(req) {
    return req.user?.keycloakSub || getKeycloakSubForUser(req.user?.id) || null;
}

async function enrichMember(m) {
    if (!m) return null;
    const kcUser = await getKeycloakUser(m.kcSub).catch(() => null);
    return {
        ...m,
        email: kcUser?.email || '',
        firstName: kcUser?.firstName || '',
        lastName: kcUser?.lastName || '',
        displayName: kcUser ? kcDisplayName(kcUser) : m.kcSub,
        avatarUrl: kcUser ? `/api/users/${encodeURIComponent(m.kcSub)}/avatar` : null,
    };
}

// Throws if removing memberId would leave a capability group with zero members.
async function assertNotLastCapabilityMember(groupId, memberId) {
    const payload = getPayloadClient();
    if (!payload) return;

    let groupDoc;
    try {
        groupDoc = await payload.findByID({ collection: 'groups', id: groupId, depth: 0 });
    } catch {
        throw new ValidationError(msg('groups.lastMember'), null, 'groups.lastMember');
    }
    if (!groupDoc?.can_approve_registrations) return;

    const count = await payload.find({
        collection: 'group-members',
        where: { group_id: { equals: String(groupId) } },
        limit: 1,
        depth: 0,
    });

    if (count.totalDocs <= 1) {
        throw new ValidationError(msg('groups.lastMember'), null, 'groups.lastMember');
    }
}

// Verifies the caller is a manager of groupId. Returns { kcSub, membership }.
async function assertGroupManager(req, groupId) {
    const kcSub = getCallerKcSub(req);
    if (!kcSub) throw new ForbiddenError(msg('groups.not_manager'));
    const memberships = await getGroupsForUser(kcSub);
    const membership = memberships.find(m => String(m.group.id) === String(groupId));
    if (!membership?.canManageGroup) throw new ForbiddenError(msg('groups.not_manager'));
    return { kcSub, membership };
}

export default function groupRoutes(app) {

    // --- Any authenticated user: create a new group (creator becomes manager) ---
    app.post('/api/my-groups',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { name, description } = req.body || {};
            if (!name || !String(name).trim()) {
                throw new ValidationError(msg('groups.name_required'), null, 'groups.name_required');
            }
            const kcSub = getCallerKcSub(req);
            if (!kcSub) {
                throw new ValidationError('User account has no Keycloak identity.', null, null);
            }
            const group = await createGroup({ name, description, canApproveRegistrations: false });
            await addGroupMember(group.id, kcSub, { canManageGroup: true });
            res.status(201).json({ data: group });
        })
    );

    // --- Any authenticated user: groups they belong to ---
    app.get('/api/my-groups',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const kcSub = getCallerKcSub(req);
            if (!kcSub) return res.json({ data: [] });
            try {
                const memberships = await getGroupsForUser(kcSub);
                res.json({ data: memberships });
            } catch (err) {
                console.warn('[my-groups] Could not load group memberships:', err?.message);
                res.json({ data: [] });
            }
        })
    );

    // --- Members of a group the caller belongs to ---
    app.get('/api/my-groups/:groupId/members',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const kcSub = getCallerKcSub(req);
            if (!kcSub) return res.json({ data: [] });
            const memberships = await getGroupsForUser(kcSub);
            const isMember = memberships.some(m => String(m.group.id) === req.params.groupId);
            if (!isMember) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            const group = await getGroup(req.params.groupId);
            const enriched = await Promise.all((group?.members ?? []).map(enrichMember));
            res.json({ data: enriched });
        })
    );

    // --- Any member: get full group detail (name, description, members) ---
    app.get('/api/my-groups/:groupId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const kcSub = getCallerKcSub(req);
            if (!kcSub) return res.json({ data: null });
            const memberships = await getGroupsForUser(kcSub);
            if (!memberships.some(m => String(m.group.id) === req.params.groupId)) {
                throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            }
            const group = await getGroup(req.params.groupId);
            if (!group) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            group.members = await Promise.all(group.members.map(enrichMember));
            res.json({ data: group });
        })
    );

    // --- Group manager: update group name/description ---
    app.patch('/api/my-groups/:groupId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            await assertGroupManager(req, req.params.groupId);
            const { name, description } = req.body || {};
            if (name !== undefined && !String(name).trim()) {
                throw new ValidationError(msg('groups.name_required'), null, 'groups.name_required');
            }
            const group = await updateGroup(req.params.groupId, { name, description });
            if (!group) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            res.json({ data: group });
        })
    );

    // --- Group manager: add a member by email ---
    app.post('/api/my-groups/:groupId/members',
        authenticateToken,
        asyncHandler(async (req, res) => {
            await assertGroupManager(req, req.params.groupId);
            const { email } = req.body || {};
            const user = email ? await findUserByEmail(String(email).trim()) : null;
            if (!user) throw new NotFoundError(msg('groups.user_not_found'), null, 'groups.user_not_found');
            try {
                const member = await addGroupMember(req.params.groupId, user.id);
                const enriched = await enrichMember(member);
                res.status(201).json({ data: enriched });
            } catch (err) {
                if (err.code === 'ALREADY_MEMBER') {
                    throw new ConflictError(msg('groups.already_member'), 'ALREADY_MEMBER', 'groups.already_member');
                }
                throw err;
            }
        })
    );

    // --- Group manager: update member permissions ---
    app.patch('/api/my-groups/:groupId/members/:memberId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { kcSub: callerKcSub } = await assertGroupManager(req, req.params.groupId);
            const { canManageGroup } = req.body || {};
            if (canManageGroup === false || canManageGroup === 'false') {
                const target = await getGroupMemberById(req.params.memberId);
                if (target?.kcSub === callerKcSub) {
                    throw new ValidationError(msg('groups.cannotRemoveOwnManage'), null, 'groups.cannotRemoveOwnManage');
                }
            }
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            const enriched = await enrichMember(member);
            res.json({ data: enriched });
        })
    );

    // --- Group manager: remove a member ---
    app.delete('/api/my-groups/:groupId/members/:memberId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            await assertGroupManager(req, req.params.groupId);
            await assertNotLastCapabilityMember(req.params.groupId, req.params.memberId);
            await removeGroupMember(req.params.memberId);
            res.json({ status: 'removed' });
        })
    );

    // --- List all groups ---
    app.get('/api/admin/groups',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (_req, res) => {
            const groups = await listGroups();
            res.json({ data: groups });
        })
    );

    // --- Create a group ---
    app.post('/api/admin/groups',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { name, description, canApproveRegistrations } = req.body || {};
            if (!name || !String(name).trim()) {
                throw new ValidationError(msg('groups.name_required'), null, 'groups.name_required');
            }
            const group = await createGroup({ name, description, canApproveRegistrations });
            res.status(201).json({ data: group });
        })
    );

    // --- Get a single group with members ---
    app.get('/api/admin/groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const group = await getGroup(req.params.id);
            if (!group) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            group.members = await Promise.all(group.members.map(enrichMember));
            res.json({ data: group });
        })
    );

    // --- Update a group ---
    app.patch('/api/admin/groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { name, description, canApproveRegistrations } = req.body || {};
            if (name !== undefined && !String(name).trim()) {
                throw new ValidationError(msg('groups.name_required'), null, 'groups.name_required');
            }
            const group = await updateGroup(req.params.id, { name, description, canApproveRegistrations });
            if (!group) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            res.json({ data: group });
        })
    );

    // --- Delete a group ---
    app.delete('/api/admin/groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const group = await getGroup(req.params.id);
            if (!group) throw new NotFoundError(msg('groups.not_found'), null, 'groups.not_found');
            if (group.canApproveRegistrations) {
                const payload = getPayloadClient();
                if (payload) {
                    const memberCount = await payload.find({
                        collection: 'group-members',
                        where: { group_id: { equals: String(req.params.id) } },
                        limit: 1,
                        depth: 0,
                    });
                    if (memberCount.totalDocs > 0) {
                        throw new ValidationError(msg('groups.cannotDeleteCapabilityGroup'), null, 'groups.cannotDeleteCapabilityGroup');
                    }
                }
            }
            await deleteGroup(req.params.id);
            res.json({ status: 'deleted' });
        })
    );

    // --- Add a member by email ---
    app.post('/api/admin/groups/:id/members',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { email } = req.body || {};
            if (!email) {
                throw new ValidationError(msg('groups.user_id_required'), null, 'groups.user_id_required');
            }
            const user = await findUserByEmail(String(email).trim());
            if (!user) {
                throw new NotFoundError(msg('groups.user_not_found'), null, 'groups.user_not_found');
            }
            try {
                const member = await addGroupMember(req.params.id, user.id);
                const enriched = await enrichMember(member);
                res.status(201).json({ data: enriched });
            } catch (err) {
                if (err.code === 'ALREADY_MEMBER') {
                    throw new ConflictError(msg('groups.already_member'), 'ALREADY_MEMBER', 'groups.already_member');
                }
                throw err;
            }
        })
    );

    // --- Update member permissions ---
    app.patch('/api/admin/groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { canManageGroup } = req.body || {};
            if (canManageGroup === false || canManageGroup === 'false') {
                const callerKcSub = getCallerKcSub(req);
                if (callerKcSub) {
                    const target = await getGroupMemberById(req.params.memberId);
                    if (target?.kcSub === callerKcSub) {
                        throw new ValidationError(msg('groups.cannotRemoveOwnManage'), null, 'groups.cannotRemoveOwnManage');
                    }
                }
            }
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            const enriched = await enrichMember(member);
            res.json({ data: enriched });
        })
    );

    // --- Remove a member ---
    app.delete('/api/admin/groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            await assertNotLastCapabilityMember(req.params.id, req.params.memberId);
            await removeGroupMember(req.params.memberId);
            res.json({ status: 'removed' });
        })
    );

}
