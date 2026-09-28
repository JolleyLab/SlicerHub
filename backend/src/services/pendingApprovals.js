/**
 * Invites waiting for the signed-in user to approve or reject: every invite awaiting approval on a
 * case where the user is an admin. Approving needs admin rights, so that is the test.
 */

import { listAwaitingApproval } from './caseInviteStore.js';

/**
 * @param {{ isCaseAdmin: (caseId: string) => Promise<boolean> }} options
 *   isCaseAdmin decides per case; a case it cannot check (throws) is left out.
 * @param {() => Promise<object[]>} [options.listInvites] where the waiting invites come from
 */
export async function listInvitesAwaitingApproval({ isCaseAdmin, listInvites = listAwaitingApproval }) {
    const invites = await listInvites();

    const caseIds = [...new Set(invites.map((invite) => invite.caseId))];
    const adminOf = new Set();
    await Promise.all(caseIds.map(async (caseId) => {
        try {
            if (await isCaseAdmin(caseId)) adminOf.add(caseId);
        } catch (err) {
            console.warn(`Pending invites: could not check admin rights on case ${caseId}:`, err.message);
        }
    }));

    return invites.filter((invite) => adminOf.has(invite.caseId));
}
