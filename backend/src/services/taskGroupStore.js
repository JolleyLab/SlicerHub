import { getPayloadClient } from '../payload/index.js';

export function mapGroup(doc) {
    if (!doc) return null;
    return {
        id: String(doc.id),
        name: doc.name || '',
        description: doc.description || '',
        canApproveRegistrations: Boolean(doc.can_approve_registrations),
        createdAt: doc.createdAt || null,
    };
}

export function mapMember(doc) {
    if (!doc) return null;
    return {
        id: String(doc.id),
        kcSub: doc.kc_sub || '',
        canManageGroup: Boolean(doc.can_manage_group),
        createdAt: doc.createdAt || null,
    };
}

/**
 * Returns true if removing memberId from a group with canApproveRegistrations would leave it empty.
 * Pure logic helper — no Payload call needed; pass the already-fetched group.
 */
export function wouldEmptyCapabilityGroup(group, memberId) {
    if (!group?.canApproveRegistrations) return false;
    return group.members.length <= 1 && group.members[0]?.id === String(memberId);
}

export async function listTaskGroups() {
    const payload = getPayloadClient();
    if (!payload) return [];
    const result = await payload.find({
        collection: 'task-groups',
        limit: 200,
        sort: 'name',
        depth: 0,
    });
    return result.docs.map(mapGroup);
}

export async function getTaskGroup(id) {
    const payload = getPayloadClient();
    if (!payload) return null;
    let doc;
    try {
        doc = await payload.findByID({ collection: 'task-groups', id, depth: 0 });
    } catch {
        return null;
    }
    const group = mapGroup(doc);
    if (!group) return null;
    const memberResult = await payload.find({
        collection: 'task-group-members',
        where: { task_group: { equals: id } },
        limit: 200,
        depth: 0,
    });
    group.members = memberResult.docs.map(mapMember);
    return group;
}

export async function createTaskGroup({ name, description, canApproveRegistrations = false }) {
    const payload = getPayloadClient();
    const doc = await payload.create({
        collection: 'task-groups',
        data: {
            name: String(name || '').trim(),
            description: String(description || '').trim() || null,
            can_approve_registrations: Boolean(canApproveRegistrations),
        },
    });
    return mapGroup(doc);
}

export async function updateTaskGroup(id, { name, description, canApproveRegistrations }) {
    const payload = getPayloadClient();
    const data = {};
    if (name !== undefined) data.name = String(name || '').trim();
    if (description !== undefined) data.description = String(description || '').trim() || null;
    if (canApproveRegistrations !== undefined) data.can_approve_registrations = Boolean(canApproveRegistrations);
    const doc = await payload.update({ collection: 'task-groups', id, data });
    return mapGroup(doc);
}

export async function deleteTaskGroup(id) {
    const payload = getPayloadClient();
    // Cascade-delete members
    const members = await payload.find({
        collection: 'task-group-members',
        where: { task_group: { equals: id } },
        limit: 1000,
        depth: 0,
    });
    await Promise.all(members.docs.map(m =>
        payload.delete({ collection: 'task-group-members', id: String(m.id) })
    ));
    await payload.delete({ collection: 'task-groups', id });
}

export async function addGroupMember(groupId, kcSub, { canManageGroup = false } = {}) {
    const payload = getPayloadClient();
    const existing = await payload.find({
        collection: 'task-group-members',
        where: {
            and: [
                { task_group: { equals: String(groupId) } },
                { kc_sub: { equals: kcSub } },
            ],
        },
        limit: 1,
        depth: 0,
    });
    if (existing.totalDocs > 0) {
        const err = new Error('User is already a member of this group');
        err.code = 'ALREADY_MEMBER';
        throw err;
    }
    const doc = await payload.create({
        collection: 'task-group-members',
        data: {
            task_group: String(groupId),
            kc_sub: kcSub,
            can_manage_group: Boolean(canManageGroup),
        },
    });
    return mapMember(doc);
}

export async function removeGroupMember(memberId) {
    const payload = getPayloadClient();
    await payload.delete({ collection: 'task-group-members', id: memberId });
}

export async function getGroupMemberById(memberId) {
    const payload = getPayloadClient();
    if (!payload) return null;
    try {
        const doc = await payload.findByID({
            collection: 'task-group-members',
            id: memberId,
            depth: 0,
        });
        return mapMember(doc);
    } catch {
        return null;
    }
}

export async function updateGroupMember(memberId, { canManageGroup }) {
    const payload = getPayloadClient();
    const data = {};
    if (canManageGroup !== undefined) data.can_manage_group = Boolean(canManageGroup);
    const doc = await payload.update({
        collection: 'task-group-members',
        id: memberId,
        data,
    });
    return mapMember(doc);
}

export async function getGroupsForUser(kcSub) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return [];
    const result = await payload.find({
        collection: 'task-group-members',
        where: { kc_sub: { equals: kcSub } },
        limit: 200,
        depth: 0,
    });
    if (!result.docs.length) return [];

    const groupIds = [...new Set(result.docs.map(m => m.task_group).filter(Boolean))];
    const groupResult = await payload.find({
        collection: 'task-groups',
        where: { id: { in: groupIds } },
        limit: 200,
        depth: 0,
    });
    const groupMap = new Map(groupResult.docs.map(g => [String(g.id), g]));

    return result.docs
        .filter(m => groupMap.has(String(m.task_group)))
        .map(m => {
            const g = groupMap.get(String(m.task_group));
            return {
                membershipId: String(m.id),
                canManageGroup: Boolean(m.can_manage_group),
                group: {
                    id: String(g.id),
                    name: g.name || '',
                    description: g.description || '',
                    canApproveRegistrations: Boolean(g.can_approve_registrations),
                },
            };
        });
}
