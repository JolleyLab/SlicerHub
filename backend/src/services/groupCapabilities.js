/**
 * Helpers for querying task group capability membership.
 *
 * Capabilities are boolean flags on the groups Payload collection.
 */

import { getPayloadClient } from '../payload/index.js';
import { getKeycloakUser } from './keycloakAdmin.js';

export const CAPABILITIES = Object.freeze({
    APPROVE_REGISTRATIONS: 'can_approve_registrations'
});

/**
 * Returns members of groups designated for the given capability.
 * Each entry: { kcSub, email, firstName, lastName, notifyRegistrationApproval }
 */
export async function getCapabilityGroupMembers(capability) {
    const payload = getPayloadClient();
    if (!payload) return [];

    const groups = await payload.find({
        collection: 'groups',
        where: { [capability]: { equals: true } },
        limit: 200,
        depth: 0,
    });
    if (!groups.totalDocs) return [];

    const groupIds = groups.docs.map(g => String(g.id));
    const memberResult = await payload.find({
        collection: 'group-members',
        where: { group_id: { in: groupIds } },
        limit: 1000,
        depth: 0,
    });

    const kcSubs = [...new Set(memberResult.docs.map(m => m.kc_sub).filter(Boolean))];
    const result = [];

    await Promise.all(kcSubs.map(async (kcSub) => {
        const kcUser = await getKeycloakUser(kcSub);
        if (!kcUser) return;

        const prefResult = await payload.find({
            collection: 'user-preferences',
            where: { keycloak_sub: { equals: kcSub } },
            limit: 1,
            depth: 0,
        });
        const pref = prefResult.docs[0];

        result.push({
            kcSub,
            email: kcUser.email || '',
            firstName: kcUser.firstName || '',
            lastName: kcUser.lastName || '',
            notifyRegistrationApproval: pref?.notify_registration_approval !== false,
        });
    }));

    return result;
}

/**
 * Returns true if the given KC sub belongs to a capability group.
 */
export async function isUserInCapabilityGroup(kcSub, capability) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return false;

    const groups = await payload.find({
        collection: 'groups',
        where: { [capability]: { equals: true } },
        limit: 200,
        depth: 0,
    });
    if (!groups.totalDocs) return false;

    const groupIds = groups.docs.map(g => String(g.id));
    const members = await payload.find({
        collection: 'group-members',
        where: {
            and: [
                { group_id: { in: groupIds } },
                { kc_sub: { equals: kcSub } },
            ],
        },
        limit: 1,
        depth: 0,
    });

    return members.totalDocs > 0;
}
