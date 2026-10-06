import { directusFetch } from './directus.js';

const GROUPS = 'task_groups';
const MEMBERS = 'task_group_members';

// Fields requested when fetching member rows — includes nested user details via M2O
const MEMBER_FIELDS = [
    'id',
    'can_manage_group',
    'date_created',
    'directus_user.id',
    'directus_user.email',
    'directus_user.first_name',
    'directus_user.last_name',
    'directus_user.avatar'
].join(',');

function mapGroup(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name || '',
        description: row.description || '',
        canApproveRegistrations: row.can_approve_registrations === true,
        createdAt: row.date_created || null
    };
}

function mapMember(row) {
    if (!row) return null;
    const user = row.directus_user && typeof row.directus_user === 'object' ? row.directus_user : null;
    return {
        id: row.id,
        directusUserId: user?.id || '',
        email: user?.email || '',
        firstName: user?.first_name || '',
        lastName: user?.last_name || '',
        avatarUrl: user?.id && user?.avatar ? `/api/directus/users/${user.id}/avatar` : null,
        canManageGroup: row.can_manage_group === true,
        createdAt: row.date_created || null
    };
}

export async function listTaskGroups() {
    const payload = await directusFetch(`/items/${GROUPS}`, {
        query: { fields: 'id,name,description,can_approve_registrations,date_created', limit: '-1', sort: 'name' }
    });
    return (Array.isArray(payload?.data) ? payload.data : []).map(mapGroup);
}

export async function getTaskGroup(id) {
    const payload = await directusFetch(`/items/${GROUPS}/${encodeURIComponent(id)}`);
    const group = mapGroup(payload?.data);
    if (!group) return null;

    const memberPayload = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            'filter[task_group][_eq]': id,
            fields: MEMBER_FIELDS,
            limit: '-1',
            sort: 'directus_user.first_name,directus_user.last_name'
        }
    });
    group.members = (Array.isArray(memberPayload?.data) ? memberPayload.data : []).map(mapMember);
    return group;
}

export async function createTaskGroup({ name, description, canApproveRegistrations = false }) {
    const payload = await directusFetch(`/items/${GROUPS}`, {
        method: 'POST',
        body: {
            name: String(name || '').trim(),
            description: String(description || '').trim() || null,
            can_approve_registrations: Boolean(canApproveRegistrations)
        }
    });
    return mapGroup(payload?.data);
}

export async function updateTaskGroup(id, { name, description, canApproveRegistrations }) {
    const body = {};
    if (name !== undefined) body.name = String(name || '').trim();
    if (description !== undefined) body.description = String(description || '').trim() || null;
    if (canApproveRegistrations !== undefined) body.can_approve_registrations = Boolean(canApproveRegistrations);

    const payload = await directusFetch(`/items/${GROUPS}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body
    });
    return mapGroup(payload?.data);
}

export async function deleteTaskGroup(id) {
    // Directus cascades to task_group_members via the FK relation
    await directusFetch(`/items/${GROUPS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function addGroupMember(groupId, directusUserId, { canManageGroup = false } = {}) {
    // Prevent duplicates
    const check = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            'filter[task_group][_eq]': groupId,
            'filter[directus_user][_eq]': directusUserId,
            fields: 'id',
            limit: '1'
        }
    });
    if ((check?.data?.length ?? 0) > 0) {
        const err = new Error('User is already a member of this group');
        err.code = 'ALREADY_MEMBER';
        throw err;
    }

    const payload = await directusFetch(`/items/${MEMBERS}`, {
        method: 'POST',
        body: { task_group: groupId, directus_user: directusUserId, can_manage_group: canManageGroup }
    });
    return { id: payload?.data?.id };
}

export async function removeGroupMember(memberId) {
    await directusFetch(`/items/${MEMBERS}/${encodeURIComponent(memberId)}`, { method: 'DELETE' });
}

export async function updateGroupMember(memberId, { canManageGroup }) {
    const body = {};
    if (canManageGroup !== undefined) body.can_manage_group = Boolean(canManageGroup);

    const payload = await directusFetch(`/items/${MEMBERS}/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body
    });
    return mapMember(payload?.data);
}

/**
 * Returns all groups a specific Directus user belongs to, with their membership details.
 */
export async function getGroupsForUser(directusUserId) {
    const payload = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            'filter[directus_user][_eq]': directusUserId,
            fields: [
                'id',
                'can_manage_group',
                'date_created',
                'task_group.id',
                'task_group.name',
                'task_group.description',
                'task_group.can_approve_registrations'
            ].join(','),
            limit: '-1',
            sort: 'task_group.name'
        }
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
        .filter(row => row.task_group && typeof row.task_group === 'object')
        .map(row => ({
            membershipId: row.id,
            canManageGroup: row.can_manage_group === true,
            group: {
                id: row.task_group.id,
                name: row.task_group.name || '',
                description: row.task_group.description || '',
                canApproveRegistrations: row.task_group.can_approve_registrations === true
            }
        }));
}

/**
 * Returns all unique member emails across all groups that have the given capability flag set.
 * Useful for sending notification emails to the right people.
 * @param {'can_approve_registrations'} capability
 */
export async function getMemberEmailsForCapability(capability) {
    const payload = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            [`filter[task_group][${capability}][_eq]`]: 'true',
            fields: 'directus_user.email',
            limit: '-1'
        }
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const emails = new Set();
    for (const row of rows) {
        const email = row.directus_user?.email;
        if (email) emails.add(String(email).toLowerCase());
    }
    return [...emails];
}
