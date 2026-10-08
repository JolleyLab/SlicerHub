/**
 * Syncs Directus per-user access policies with task group capability membership.
 *
 * When a user joins a capability group they automatically receive the corresponding
 * Directus policy, allowing their own token to write capability-gated resources
 * (so Directus activity logs record the real actor, not the service account).
 * When they leave all groups carrying that capability the policy is revoked.
 *
 * Each capability maps to a Directus policy by name. The policy must exist in
 * Directus with that exact name — the ID is looked up once and cached in-process.
 *
 * All exported functions are safe to fire-and-forget: they swallow errors internally
 * and must never throw to the caller.
 */

import { directusFetch } from './directus.js';
import { CAPABILITIES, isUserInCapabilityGroup } from './groupCapabilities.js';

// Policy name must match exactly what is created in Directus.
const CAPABILITY_POLICY_NAME = {
    [CAPABILITIES.APPROVE_REGISTRATIONS]: 'Can Approve Registrations'
};

// In-process cache — resets on restart, cheap to re-populate on next request.
const _policyIdCache = new Map();

async function getPolicyId(name) {
    if (_policyIdCache.has(name)) return _policyIdCache.get(name);
    const res = await directusFetch('/policies', {
        query: { 'filter[name][_eq]': name, fields: 'id', limit: '1' }
    });
    const id = res?.data?.[0]?.id ?? null;
    if (id) _policyIdCache.set(name, id);
    return id;
}

async function _grant(directusUserId, policyId) {
    // Idempotent — no-op if already granted.
    const check = await directusFetch('/access', {
        query: {
            'filter[user][_eq]': directusUserId,
            'filter[policy][_eq]': policyId,
            fields: 'id',
            limit: '1'
        }
    });
    if (check?.data?.length) return;
    await directusFetch('/access', {
        method: 'POST',
        body: { user: directusUserId, policy: policyId }
    });
}

async function _revoke(directusUserId, policyId) {
    const check = await directusFetch('/access', {
        query: {
            'filter[user][_eq]': directusUserId,
            'filter[policy][_eq]': policyId,
            fields: 'id',
            limit: '1'
        }
    });
    const accessId = check?.data?.[0]?.id;
    if (!accessId) return;
    await directusFetch(`/access/${accessId}`, { method: 'DELETE' });
}

/**
 * Call after adding a user to a group.
 * Grants policies for any capabilities the group carries.
 */
export async function syncOnMemberAdded(groupId, directusUserId) {
    if (!directusUserId) return;
    try {
        const res = await directusFetch(`/items/task_groups/${encodeURIComponent(groupId)}`, {
            query: { fields: 'can_approve_registrations' }
        });
        const raw = res?.data;
        if (!raw) return;

        for (const [capability, policyName] of Object.entries(CAPABILITY_POLICY_NAME)) {
            if (!raw[capability]) continue;
            const policyId = await getPolicyId(policyName);
            if (policyId) await _grant(directusUserId, policyId);
        }
    } catch (err) {
        console.warn('[policy-sync] syncOnMemberAdded failed:', err?.message);
    }
}

/**
 * Call after removing a user from a group.
 * Revokes any policies the user no longer qualifies for (checks all capability groups).
 */
export async function syncOnMemberRemoved(directusUserId) {
    if (!directusUserId) return;
    try {
        for (const [capability, policyName] of Object.entries(CAPABILITY_POLICY_NAME)) {
            const stillQualifies = await isUserInCapabilityGroup(directusUserId, capability);
            if (stillQualifies) continue;
            const policyId = await getPolicyId(policyName);
            if (policyId) await _revoke(directusUserId, policyId);
        }
    } catch (err) {
        console.warn('[policy-sync] syncOnMemberRemoved failed:', err?.message);
    }
}

/**
 * Full reconciliation: grants policies to anyone who qualifies but lacks them,
 * revokes policies from anyone who no longer qualifies.
 * Safe to run on a schedule — idempotent, only writes on drift.
 */
export async function reconcileAllPolicies() {
    try {
        for (const [capability, policyName] of Object.entries(CAPABILITY_POLICY_NAME)) {
            const policyId = await getPolicyId(policyName);
            if (!policyId) {
                console.warn(`[policy-sync] reconcile: policy "${policyName}" not found in Directus — skipping`);
                continue;
            }

            // Who currently has the Directus policy?
            const accessRes = await directusFetch('/access', {
                query: { 'filter[policy][_eq]': policyId, fields: 'id,user', limit: '-1' }
            });
            const currentAccess = (accessRes?.data ?? []).filter(r => r.user);
            const hasPolicy = new Set(currentAccess.map(r => r.user));

            // Who is in a capability group that grants it?
            const groupRes = await directusFetch('/items/task_groups', {
                query: { 'filter[can_approve_registrations][_eq]': 'true', fields: 'id', limit: '-1' }
            });
            const capGroupIds = (groupRes?.data ?? []).map(g => g.id);

            let shouldHave = new Set();
            if (capGroupIds.length) {
                const memberRes = await directusFetch('/items/task_group_members', {
                    query: {
                        'filter[task_group][_in]': capGroupIds.join(','),
                        fields: 'directus_user',
                        limit: '-1'
                    }
                });
                shouldHave = new Set(
                    (memberRes?.data ?? [])
                        .map(r => typeof r.directus_user === 'object' ? r.directus_user?.id : r.directus_user)
                        .filter(Boolean)
                );
            }

            let granted = 0, revoked = 0;
            await Promise.allSettled([
                ...[...shouldHave].filter(uid => !hasPolicy.has(uid)).map(async uid => {
                    await _grant(uid, policyId);
                    granted++;
                }),
                ...currentAccess.filter(r => !shouldHave.has(r.user)).map(async r => {
                    await directusFetch(`/access/${r.id}`, { method: 'DELETE' });
                    revoked++;
                })
            ]);

            if (granted || revoked) {
                console.log(`[policy-sync] reconcile "${policyName}": +${granted} granted, -${revoked} revoked`);
            }
        }
    } catch (err) {
        console.warn('[policy-sync] reconcileAllPolicies failed:', err?.message);
    }
}

// Runs once daily at 03:00 server time.
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let _reconcileTimer = null;

export function startPolicySyncScheduler() {
    if (_reconcileTimer) return;

    const msUntil3am = () => {
        const now = new Date();
        const next = new Date(now);
        next.setHours(3, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next - now;
    };

    const scheduleNext = () => {
        _reconcileTimer = setTimeout(async () => {
            await reconcileAllPolicies();
            _reconcileTimer = setInterval(async () => {
                await reconcileAllPolicies();
            }, RECONCILE_INTERVAL_MS);
        }, msUntil3am());
    };

    scheduleNext();
}

/**
 * Call when a group's capability flag is toggled (e.g. canApproveRegistrations on/off).
 * Grants or revokes the corresponding policy for every current member of the group.
 * On revoke, checks each member hasn't retained the capability via another group.
 */
export async function syncOnGroupCapabilityToggled(groupId, capability, enabled) {
    const policyName = CAPABILITY_POLICY_NAME[capability];
    if (!policyName) return;
    try {
        const policyId = await getPolicyId(policyName);
        if (!policyId) {
            console.warn(`[policy-sync] Policy "${policyName}" not found in Directus — skipping sync`);
            return;
        }

        const memberRes = await directusFetch('/items/task_group_members', {
            query: {
                'filter[task_group][_eq]': groupId,
                fields: 'directus_user',
                limit: '-1'
            }
        });
        const memberIds = (memberRes?.data ?? [])
            .map(r => (typeof r.directus_user === 'object' ? r.directus_user?.id : r.directus_user))
            .filter(Boolean);

        if (!memberIds.length) return;

        await Promise.allSettled(memberIds.map(async uid => {
            if (enabled) {
                await _grant(uid, policyId);
            } else {
                const stillQualifies = await isUserInCapabilityGroup(uid, capability);
                if (!stillQualifies) await _revoke(uid, policyId);
            }
        }));
    } catch (err) {
        console.warn('[policy-sync] syncOnGroupCapabilityToggled failed:', err?.message);
    }
}
