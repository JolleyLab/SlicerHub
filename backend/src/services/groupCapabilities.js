/**
 * Generic helpers for querying task group capability membership.
 *
 * Capabilities are boolean flags on the task_groups Directus collection.
 * Each capability designates exactly one group (the flag is a singleton by design —
 * the system pre-fills that group and the UI does not allow adding the flag to others).
 *
 * These helpers are intentionally capability-agnostic so new capabilities can be
 * wired up simply by adding a constant and calling the generic functions.
 */

import { directusFetch } from './directus.js';

const MEMBERS = 'task_group_members';

export const CAPABILITIES = Object.freeze({
    APPROVE_REGISTRATIONS: 'can_approve_registrations'
    // Add future capabilities here, e.g.:
    // MANAGE_BILLING: 'can_manage_billing'
});

/**
 * Returns members of the single group designated for the given capability.
 * Each entry: { directusUserId, email, firstName, lastName }
 */
export async function getCapabilityGroupMembers(capability) {
    const payload = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            [`filter[task_group][${capability}][_eq]`]: 'true',
            fields: [
                'directus_user.id',
                'directus_user.email',
                'directus_user.first_name',
                'directus_user.last_name',
                'directus_user.notify_registration_approval'
            ].join(','),
            limit: '-1'
        }
    });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
        .filter(row => row.directus_user?.id)
        .map(row => ({
            directusUserId: String(row.directus_user.id),
            email: row.directus_user.email || '',
            firstName: row.directus_user.first_name || '',
            lastName: row.directus_user.last_name || '',
            notifyRegistrationApproval: row.directus_user.notify_registration_approval !== false
        }));
}

/**
 * Returns true if the given Directus user is a member of the capability group.
 */
export async function isUserInCapabilityGroup(directusUserId, capability) {
    if (!directusUserId) return false;
    const payload = await directusFetch(`/items/${MEMBERS}`, {
        query: {
            [`filter[task_group][${capability}][_eq]`]: 'true',
            'filter[directus_user][_eq]': String(directusUserId),
            fields: 'id',
            limit: '1'
        }
    });
    return (payload?.data?.length ?? 0) > 0;
}
