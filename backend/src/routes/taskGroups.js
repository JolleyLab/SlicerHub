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
    listTaskGroups,
    getTaskGroup,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
    addGroupMember,
    removeGroupMember,
    updateGroupMember,
    getGroupMemberById,
    getGroupsForUser,
    wouldEmptyCapabilityGroup,
} from '../services/taskGroupStore.js';

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
// Uses direct Payload count queries rather than the joined getTaskGroup result,
// so a member-fetch miss cannot silently bypass the guard.
async function assertNotLastCapabilityMember(groupId, memberId) {
    const payload = getPayloadClient();
    if (!payload) return;

    // 1. Is this a capability group?
    let groupDoc;
    try {
        groupDoc = await payload.findByID({ collection: 'task-groups', id: groupId, depth: 0 });
    } catch {
        // Can't confirm group type — block to be safe
        throw new ValidationError(msg('taskGroups.lastMember'), null, 'taskGroups.lastMember');
    }
    if (!groupDoc?.can_approve_registrations) return;

    // 2. How many members does this group currently have?
    const count = await payload.find({
        collection: 'task-group-members',
        where: { task_group: { equals: String(groupId) } },
        limit: 1,
        depth: 0,
    });
    console.log(`[lastMemberGuard] groupId=${groupId} memberId=${memberId} totalDocs=${count.totalDocs}`);

    if (count.totalDocs <= 1) {
        throw new ValidationError(msg('taskGroups.lastMember'), null, 'taskGroups.lastMember');
    }
}

// Verifies the caller is a manager of groupId. Returns { kcSub, membership }.
async function assertGroupManager(req, groupId) {
    const kcSub = getCallerKcSub(req);
    if (!kcSub) throw new ForbiddenError(msg('taskGroups.not_manager'));
    const memberships = await getGroupsForUser(kcSub);
    const membership = memberships.find(m => String(m.group.id) === String(groupId));
    if (!membership?.canManageGroup) throw new ForbiddenError(msg('taskGroups.not_manager'));
    return { kcSub, membership };
}

export default function taskGroupRoutes(app) {

    // --- Any authenticated user: create a new group (creator becomes manager) ---
    app.post('/api/my-groups',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { name, description } = req.body || {};
            if (!name || !String(name).trim()) {
                throw new ValidationError(msg('taskGroups.name_required'), null, 'taskGroups.name_required');
            }
            const kcSub = getCallerKcSub(req);
            if (!kcSub) {
                throw new ValidationError('User account has no Keycloak identity.', null, null);
            }
            const group = await createTaskGroup({ name, description, canApproveRegistrations: false });
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
            if (!isMember) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            const group = await getTaskGroup(req.params.groupId);
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
                throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            }
            const group = await getTaskGroup(req.params.groupId);
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
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
                throw new ValidationError(msg('taskGroups.name_required'), null, 'taskGroups.name_required');
            }
            const group = await updateTaskGroup(req.params.groupId, { name, description });
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
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
            if (!user) throw new NotFoundError(msg('taskGroups.user_not_found'), null, 'taskGroups.user_not_found');
            try {
                const member = await addGroupMember(req.params.groupId, user.id);
                const enriched = await enrichMember(member);
                res.status(201).json({ data: enriched });
            } catch (err) {
                if (err.code === 'ALREADY_MEMBER') {
                    throw new ConflictError(msg('taskGroups.already_member'), 'ALREADY_MEMBER', 'taskGroups.already_member');
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
                    throw new ValidationError(msg('taskGroups.cannotRemoveOwnManage'), null, 'taskGroups.cannotRemoveOwnManage');
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
    app.get('/api/admin/task-groups',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (_req, res) => {
            const groups = await listTaskGroups();
            res.json({ data: groups });
        })
    );

    // --- Create a group ---
    app.post('/api/admin/task-groups',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { name, description, canApproveRegistrations } = req.body || {};
            if (!name || !String(name).trim()) {
                throw new ValidationError(msg('taskGroups.name_required'), null, 'taskGroups.name_required');
            }
            const group = await createTaskGroup({ name, description, canApproveRegistrations });
            res.status(201).json({ data: group });
        })
    );

    // --- Get a single group with members ---
    app.get('/api/admin/task-groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const group = await getTaskGroup(req.params.id);
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            group.members = await Promise.all(group.members.map(enrichMember));
            res.json({ data: group });
        })
    );

    // --- Update a group ---
    app.patch('/api/admin/task-groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { name, description, canApproveRegistrations } = req.body || {};
            if (name !== undefined && !String(name).trim()) {
                throw new ValidationError(msg('taskGroups.name_required'), null, 'taskGroups.name_required');
            }
            const group = await updateTaskGroup(req.params.id, { name, description, canApproveRegistrations });
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            res.json({ data: group });
        })
    );

    // --- Delete a group ---
    app.delete('/api/admin/task-groups/:id',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const group = await getTaskGroup(req.params.id);
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            if (group.canApproveRegistrations) {
                const payload = getPayloadClient();
                if (payload) {
                    const memberCount = await payload.find({
                        collection: 'task-group-members',
                        where: { task_group: { equals: String(req.params.id) } },
                        limit: 1,
                        depth: 0,
                    });
                    if (memberCount.totalDocs > 0) {
                        throw new ValidationError(msg('taskGroups.cannotDeleteCapabilityGroup'), null, 'taskGroups.cannotDeleteCapabilityGroup');
                    }
                }
            }
            await deleteTaskGroup(req.params.id);
            res.json({ status: 'deleted' });
        })
    );

    // --- Add a member by email ---
    app.post('/api/admin/task-groups/:id/members',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { email } = req.body || {};
            if (!email) {
                throw new ValidationError(msg('taskGroups.user_id_required'), null, 'taskGroups.user_id_required');
            }
            const user = await findUserByEmail(String(email).trim());
            if (!user) {
                throw new NotFoundError(msg('taskGroups.user_not_found'), null, 'taskGroups.user_not_found');
            }
            try {
                const member = await addGroupMember(req.params.id, user.id);
                const enriched = await enrichMember(member);
                res.status(201).json({ data: enriched });
            } catch (err) {
                if (err.code === 'ALREADY_MEMBER') {
                    throw new ConflictError(msg('taskGroups.already_member'), 'ALREADY_MEMBER', 'taskGroups.already_member');
                }
                throw err;
            }
        })
    );

    // --- Update member permissions ---
    app.patch('/api/admin/task-groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { canManageGroup } = req.body || {};
            if (canManageGroup === false || canManageGroup === 'false') {
                const callerKcSub = getCallerKcSub(req);
                if (callerKcSub) {
                    const target = await getGroupMemberById(req.params.memberId);
                    if (target?.kcSub === callerKcSub) {
                        throw new ValidationError(msg('taskGroups.cannotRemoveOwnManage'), null, 'taskGroups.cannotRemoveOwnManage');
                    }
                }
            }
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            const enriched = await enrichMember(member);
            res.json({ data: enriched });
        })
    );

    // --- Remove a member ---
    app.delete('/api/admin/task-groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            await assertNotLastCapabilityMember(req.params.id, req.params.memberId);
            await removeGroupMember(req.params.memberId);
            res.json({ status: 'removed' });
        })
    );

}
