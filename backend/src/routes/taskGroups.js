import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { requireDirectusRole } from '../auth/requireDirectusRole.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { findDirectusUserByEmail } from '../services/directus.js';
import { findDirectusLinkForUser } from '../auth/identityStore.js';
import { syncOnMemberAdded, syncOnMemberRemoved, syncOnGroupCapabilityToggled } from '../services/directusPolicySync.js';
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
    getGroupsForUser
} from '../services/taskGroupStore.js';

const requireOrgAdmin = [
    requireDirectusLink,
    requireDirectusUserToken,
    requireDirectusRole('OrgAdmin', 'Administrator')
];

// Resolves the caller's Directus user ID and verifies they have canManageGroup for groupId.
async function assertGroupManager(req, groupId) {
    const link = findDirectusLinkForUser(req.user?.id);
    if (!link?.external_id) throw new ForbiddenError(msg('directus.not_linked'));
    const memberships = await getGroupsForUser(link.external_id);
    const membership = memberships.find(m => m.group.id === groupId);
    if (!membership?.canManageGroup) throw new ForbiddenError(msg('taskGroups.not_manager'));
    return { link, membership };
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
            const link = findDirectusLinkForUser(req.user.id);
            if (!link) {
                throw new ValidationError('User account is not linked to the directory.', null, null);
            }
            const group = await createTaskGroup({ name, description, canApproveRegistrations: false });
            await addGroupMember(group.id, link.external_id, { canManageGroup: true });
            res.status(201).json({ data: group });
        })
    );

    // --- Any authenticated user: groups they belong to ---
    app.get('/api/my-groups',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const link = findDirectusLinkForUser(req.user.id);
            if (!link) return res.json({ data: [] });
            try {
                const memberships = await getGroupsForUser(link.external_id);
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
            const link = findDirectusLinkForUser(req.user.id);
            if (!link) return res.json({ data: [] });
            const memberships = await getGroupsForUser(link.external_id);
            const isMember = memberships.some(m => m.group.id === req.params.groupId);
            if (!isMember) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            const group = await getTaskGroup(req.params.groupId);
            res.json({ data: group?.members ?? [] });
        })
    );

    // --- Any member: get full group detail (name, description, members) ---
    app.get('/api/my-groups/:groupId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const link = findDirectusLinkForUser(req.user?.id);
            if (!link?.external_id) return res.json({ data: null });
            const memberships = await getGroupsForUser(link.external_id);
            if (!memberships.some(m => m.group.id === req.params.groupId)) {
                throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
            }
            const group = await getTaskGroup(req.params.groupId);
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');
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
            const user = email ? await findDirectusUserByEmail(String(email).trim()) : null;
            if (!user) throw new NotFoundError(msg('taskGroups.user_not_found'), null, 'taskGroups.user_not_found');
            try {
                const member = await addGroupMember(req.params.groupId, user.id);
                syncOnMemberAdded(req.params.groupId, user.id).catch(() => {});
                res.status(201).json({ data: member });
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
            const { link } = await assertGroupManager(req, req.params.groupId);
            const { canManageGroup } = req.body || {};
            if (canManageGroup === false || canManageGroup === 'false') {
                const target = await getGroupMemberById(req.params.memberId);
                if (target?.directusUserId === link.external_id) {
                    throw new ValidationError(msg('taskGroups.cannotRemoveOwnManage'), null, 'taskGroups.cannotRemoveOwnManage');
                }
            }
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            res.json({ data: member });
        })
    );

    // --- Group manager: remove a member ---
    app.delete('/api/my-groups/:groupId/members/:memberId',
        authenticateToken,
        asyncHandler(async (req, res) => {
            await assertGroupManager(req, req.params.groupId);
            const leaving = await getGroupMemberById(req.params.memberId);
            await removeGroupMember(req.params.memberId);
            if (leaving?.directusUserId) syncOnMemberRemoved(leaving.directusUserId).catch(() => {});
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

            // Capture the current capability flag before the update so we can detect a change.
            let prevCanApprove = undefined;
            if (canApproveRegistrations !== undefined) {
                const current = await getTaskGroup(req.params.id);
                if (current) prevCanApprove = current.canApproveRegistrations;
            }

            const group = await updateTaskGroup(req.params.id, { name, description, canApproveRegistrations });
            if (!group) throw new NotFoundError(msg('taskGroups.not_found'), null, 'taskGroups.not_found');

            if (canApproveRegistrations !== undefined && prevCanApprove !== undefined
                && Boolean(canApproveRegistrations) !== prevCanApprove) {
                syncOnGroupCapabilityToggled(
                    req.params.id,
                    CAPABILITIES.APPROVE_REGISTRATIONS,
                    Boolean(canApproveRegistrations)
                ).catch(() => {});
            }

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
            await deleteTaskGroup(req.params.id);
            res.json({ status: 'deleted' });
        })
    );

    // --- Add a member (by Directus user ID or email) ---
    app.post('/api/admin/task-groups/:id/members',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const { directusUserId, email } = req.body || {};

            let userId = directusUserId ? String(directusUserId).trim() : null;

            if (!userId && email) {
                const user = await findDirectusUserByEmail(String(email).trim());
                if (!user) {
                    throw new NotFoundError(msg('taskGroups.user_not_found'), null, 'taskGroups.user_not_found');
                }
                userId = user.id;
            }

            if (!userId) {
                throw new ValidationError(msg('taskGroups.user_id_required'), null, 'taskGroups.user_id_required');
            }

            try {
                const member = await addGroupMember(req.params.id, userId);
                syncOnMemberAdded(req.params.id, userId).catch(() => {});
                res.status(201).json({ data: member });
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
            // Prevent users from removing their own manage permission
            if (canManageGroup === false || canManageGroup === 'false') {
                const callerLink = findDirectusLinkForUser(req.user.id);
                if (callerLink?.external_id) {
                    const target = await getGroupMemberById(req.params.memberId);
                    if (target?.directusUserId === callerLink.external_id) {
                        throw new ValidationError(msg('taskGroups.cannotRemoveOwnManage'), null, 'taskGroups.cannotRemoveOwnManage');
                    }
                }
            }
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            res.json({ data: member });
        })
    );

    // --- Remove a member ---
    app.delete('/api/admin/task-groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const leaving = await getGroupMemberById(req.params.memberId);
            await removeGroupMember(req.params.memberId);
            if (leaving?.directusUserId) syncOnMemberRemoved(leaving.directusUserId).catch(() => {});
            res.json({ status: 'removed' });
        })
    );

}
