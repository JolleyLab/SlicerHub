/**
 * Case invites to a new email that are never taken up.
 *
 * A signup invite creates a Keycloak account (with the case role) that the invitee sets
 * up from Keycloak's emailed link. If the invite expires (CASE_INVITE_TTL_DAYS) or is
 * rejected before that happens, the account is removed, so the email and case role
 * don't linger. The invite record itself is deleted by the retention sweep 30 days
 * later (services/dataRetention.js).
 */

import { deleteAccountIfNeverSetUp } from './keycloakAdmin.js';

/**
 * Remove the invitee's Keycloak account if it was made for an invite and never set up,
 * and no other signup invite is still waiting on it. Returns true if removed.
 */
export async function removeUnusedInviteeAccount(payload, keycloakUserId, { now = Date.now() } = {}) {
    if (!payload || !keycloakUserId) return false;
    const stillWaiting = await payload.find({
        collection: 'case-invites',
        where: {
            and: [
                { keycloak_user_id: { equals: keycloakUserId } },
                { status:           { equals: 'pending_signup' } },
                { expires_at:       { greater_than: new Date(now).toISOString() } },
            ],
        },
        limit: 1,
        depth: 0,
    });
    if (stillWaiting.docs.length) return false;
    return deleteAccountIfNeverSetUp(keycloakUserId);
}

/** Mark signup invites past their expiry as expired, and remove unused accounts. */
export async function expireStaleInvites(payload, { now = Date.now() } = {}) {
    if (!payload) return;
    try {
        const stale = await payload.find({
            collection: 'case-invites',
            where: {
                status:     { equals: 'pending_signup' },
                expires_at: { less_than: new Date(now).toISOString() },
            },
            limit: 200,
            depth: 0,
        });
        let removed = 0;
        for (const inv of stale.docs) {
            await payload.update({ collection: 'case-invites', id: inv.id, data: { status: 'expired' } });
            if (inv.keycloak_user_id) {
                const gone = await removeUnusedInviteeAccount(payload, inv.keycloak_user_id, { now })
                    .catch((err) => {
                        console.warn('[invites] Could not remove unused invitee account:', err.message);
                        return false;
                    });
                if (gone) removed++;
            }
        }
        if (stale.docs.length) {
            console.log(`[invites] Expired ${stale.docs.length} unused case invite(s); removed ${removed} account(s) never set up`);
        }
    } catch (err) {
        console.warn('[invites] Case invite expiry sweep failed:', err.message);
    }
}
