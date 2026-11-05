/**
 * Links SlicerHub groups (Payload `groups`/`group-members`) to case roles.
 * Membership in a linked group grants its role on the case dynamically —
 * joining or leaving the group changes access immediately, no fan-out needed.
 */

import { getPayloadClient } from '../payload/index.js';
import { getGroupsForUser } from './groupStore.js';

const ROLE_RANK = { admin: 3, collaborator: 2, read_only: 1 };

function higherRole(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (ROLE_RANK[b] ?? 0) > (ROLE_RANK[a] ?? 0) ? b : a;
}

// Payload rejects a string id for the integer `case` relationship on create.
function caseKey(caseId) {
    return Number(caseId);
}

export async function listGroupAccessForCase(caseId) {
    const payload = getPayloadClient();
    if (!payload) return [];
    const result = await payload.find({
        collection: 'case-group-access',
        where: { case: { equals: caseKey(caseId) } },
        limit: 200,
        depth: 0,
    });
    return result.docs.map(d => ({ id: String(d.id), groupId: d.group_id, role: d.role }));
}

export async function setGroupAccessForCase(caseId, groupId, role) {
    const payload = getPayloadClient();
    const existing = await payload.find({
        collection: 'case-group-access',
        where: {
            and: [
                { case: { equals: caseKey(caseId) } },
                { group_id: { equals: String(groupId) } },
            ],
        },
        limit: 1,
        depth: 0,
    });
    if (existing.docs.length) {
        return payload.update({ collection: 'case-group-access', id: existing.docs[0].id, data: { role } });
    }
    return payload.create({ collection: 'case-group-access', data: { case: caseKey(caseId), group_id: String(groupId), role } });
}

export async function removeAllGroupAccessForCase(caseId) {
    const payload = getPayloadClient();
    if (!payload) return;
    await payload.delete({ collection: 'case-group-access', where: { case: { equals: caseKey(caseId) } } });
}

/**
 * Unlinks a deleted group from every case and deletes its requests,
 * so cases don't keep an "Unknown group" collaborator or invite row.
 */
export async function removeGroupFromAllCases(groupId) {
    const payload = getPayloadClient();
    if (!payload) return;
    await payload.delete({ collection: 'case-group-access', where: { group_id: { equals: String(groupId) } } });
    await payload.delete({
        collection: 'case-invites',
        where: {
            and: [
                { kind: { equals: 'group' } },
                { group_id: { equals: String(groupId) } },
            ],
        },
    });
}

export async function removeGroupAccessForCase(caseId, groupId) {
    const payload = getPayloadClient();
    const existing = await payload.find({
        collection: 'case-group-access',
        where: {
            and: [
                { case: { equals: caseKey(caseId) } },
                { group_id: { equals: String(groupId) } },
            ],
        },
        limit: 1,
        depth: 0,
    });
    if (existing.docs.length) {
        await payload.delete({ collection: 'case-group-access', id: existing.docs[0].id });
    }
}

/**
 * The highest case role a Keycloak user holds via their SlicerHub group memberships.
 * Returns 'admin' | 'collaborator' | 'read_only' | null.
 */
export async function getCaseRoleFromGroups(kcSub, caseId) {
    if (!kcSub) return null;
    const payload = getPayloadClient();
    if (!payload) return null;

    const memberships = await getGroupsForUser(kcSub);
    if (!memberships.length) return null;
    const groupIds = memberships.map(m => m.group.id);

    const result = await payload.find({
        collection: 'case-group-access',
        where: {
            and: [
                { case: { equals: caseKey(caseId) } },
                { group_id: { in: groupIds } },
            ],
        },
        limit: 50,
        depth: 0,
    });

    return result.docs.reduce((best, d) => higherRole(best, d.role), null);
}

/**
 * caseId → role map for every case a Keycloak user reaches via group membership.
 */
export async function getCaseRoleMapFromGroups(kcSub) {
    if (!kcSub) return {};
    const payload = getPayloadClient();
    if (!payload) return {};

    const memberships = await getGroupsForUser(kcSub);
    if (!memberships.length) return {};
    const groupIds = memberships.map(m => m.group.id);

    const result = await payload.find({
        collection: 'case-group-access',
        where: { group_id: { in: groupIds } },
        limit: 500,
        depth: 0,
    });

    const map = {};
    for (const d of result.docs) {
        const caseId = String(d.case?.id ?? d.case);
        map[caseId] = higherRole(map[caseId], d.role);
    }
    return map;
}
