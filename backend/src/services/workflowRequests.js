/**
 * Requests for a public workflow on a case (docs/workflows-design.md › Requests). One
 * case-workflows row per (case, workflow) carries the request: its requesters (Keycloak subs
 * only; names are looked up when shown) and, after a decline, the reason.
 */

import { getPayloadClient } from '../payload/index.js';
import { NotFoundError } from '../utils/errors.js';
import { isDocId } from '../utils/validation.js';
import { getCaseRoleForSub } from '../utils/caseAccess.js';
import { getKeycloakUser, kcDisplayName } from './keycloakAdmin.js';
import { createNotification } from './notifications.js';
import { WORKFLOWS, CASE_WORKFLOWS, findAll } from './workflows.js';

/** Members below this role (read_only) can't request workflows. */
export const REQUEST_MIN_ROLE = 'collaborator';
const CAN_REQUEST = new Set(['collaborator', 'admin']);

export const canRequest = (role) => CAN_REQUEST.has(role);
export const isPending = (row) => row.status === 'pending';
export const requestersOf = (row) => (Array.isArray(row.requesters) ? row.requesters.map(String) : []);

/** A case-workflows row by id, only if it belongs to `caseId`. */
export async function loadCaseWorkflowRow(caseId, rowId) {
    const row = isDocId(rowId)
        ? await getPayloadClient().findByID({ collection: CASE_WORKFLOWS, id: rowId, depth: 0, disableErrors: true })
        : null;
    if (!row || String(row.case) !== String(caseId)) throw new NotFoundError('Not found');
    return row;
}

/** Requesters who may still request: anyone who left the case, or is now read_only, is dropped. */
async function currentRequesters(row, caseDoc) {
    const subs = requestersOf(row);
    const roles = await Promise.all(subs.map((sub) => getCaseRoleForSub(caseDoc, sub).catch(() => null)));
    return subs.filter((_, i) => canRequest(roles[i]));
}

const displayName = async (sub) => kcDisplayName(await getKeycloakUser(sub).catch(() => null)) || null;

/**
 * Pending rows as admins see them, with requester names. A request whose requesters have all
 * left is deleted; one with some gone is saved without them.
 */
export async function describeRequests(rows, caseById) {
    const payload = getPayloadClient();
    const pending = rows.filter(isPending);
    const sourceIds = [...new Set(pending.map((r) => r.workflow))];
    const publicIds = new Set(sourceIds.length
        ? (await findAll(WORKFLOWS, { id: { in: sourceIds } })).filter((d) => d.visibility === 'public').map((d) => String(d.id))
        : []);
    const described = await Promise.all(pending.map(async (row) => {
        const caseDoc = caseById.get(String(row.case));
        const subs = await currentRequesters(row, caseDoc);
        if (!subs.length) {
            await payload.delete({ collection: CASE_WORKFLOWS, id: row.id });
            return null;
        }
        if (subs.length !== requestersOf(row).length) {
            await payload.update({ collection: CASE_WORKFLOWS, id: row.id, data: { requesters: subs } });
        }
        return {
            id: row.id,
            caseId: String(row.case),
            caseTitle: caseDoc?.title ?? null,
            workflowId: row.workflow,
            name: row.name,
            description: row.description || '',
            extensions: row.extensions || [],
            requesterNames: await Promise.all(subs.map(displayName)),
            requestedAt: row.requested_at ?? null,
            previousDecline: row.decided_at ? { at: row.decided_at, reason: row.decline_reason || '' } : null,
            sourcePublic: publicIds.has(String(row.workflow)),
        };
    }));
    return described.filter(Boolean);
}

/** Tell each requester the outcome. Never throws (createNotification doesn't). */
export function notifyRequesters(row, caseDoc, outcome, reason = '') {
    const caseTitle = caseDoc?.title || 'a case';
    const approved = outcome === 'approved';
    return Promise.all(requestersOf(row).map((userId) => createNotification({
        userId,
        type: approved ? 'workflow_request_approved' : 'workflow_request_declined',
        title: approved
            ? `"${row.name}" is now available in "${caseTitle}"`
            : `"${row.name}" wasn't added to "${caseTitle}"`,
        body: approved ? null : (reason || null),
        caseId: String(caseDoc?.id ?? row.case),
    })));
}
