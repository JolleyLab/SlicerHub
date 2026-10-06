import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { requireDirectusRole } from '../auth/requireDirectusRole.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { findDirectusUserByEmail } from '../services/directus.js';
import { findDirectusLinkForUser } from '../auth/identityStore.js';
import {
    listTaskGroups,
    getTaskGroup,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
    addGroupMember,
    removeGroupMember,
    updateGroupMember,
    getGroupsForUser
} from '../services/taskGroupStore.js';

const requireOrgAdmin = [
    requireDirectusLink,
    requireDirectusUserToken,
    requireDirectusRole('OrgAdmin', 'Administrator')
];

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
            const member = await updateGroupMember(req.params.memberId, { canManageGroup });
            res.json({ data: member });
        })
    );

    // --- Remove a member ---
    app.delete('/api/admin/task-groups/:id/members/:memberId',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            await removeGroupMember(req.params.memberId);
            res.json({ status: 'removed' });
        })
    );

}
