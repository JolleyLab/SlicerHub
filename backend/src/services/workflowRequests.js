/**
 * Requests for a public workflow on a case (docs/workflows-design.md › Requests). One
 * case-workflows row per (case, workflow) carries the request (and, after a decline, the
 * reason); who asked is one case-workflow-requesters row per person, under the same key.
 * Requesters are Keycloak subs only; names are looked up when shown.
 */

import { getPayloadClient } from '../payload/index.js';
import { NotFoundError } from '../utils/errors.js';
import { isDocId } from '../utils/validation.js';
import { getCaseRoleForSub } from '../utils/caseAccess.js';
import { getKeycloakUser, kcDisplayName } from './keycloakAdmin.js';
import { createNotification } from './notifications.js';
import { WORKFLOWS, CASE_WORKFLOWS, REQUEST_STATUS, VISIBILITY, findAll, copyDiffers } from './workflows.js';

export const CASE_WORKFLOW_REQUESTERS = 'case-workflow-requesters';

/** Members below this role (read_only) can't request workflows. */
export const REQUEST_MIN_ROLE = 'collaborator';
const CAN_REQUEST = new Set(['collaborator', 'admin']);

/**
 * After a decline, members can ask for the same workflow again this long after (admins can still
 * add it). Long enough that nobody asks again straight away; the per-person rate limit and
 * MAX_PENDING_PER_MEMBER are what keep the load down.
 */
export const REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** How many requests one member can have waiting on one case. */
export const MAX_PENDING_PER_MEMBER = 10;

export const canRequest = (role) => CAN_REQUEST.has(role);
export const isPending = (row) => row.status === REQUEST_STATUS.PENDING;

/**
 * Whether a declined row can't be asked for again yet: it was declined less than
 * REQUEST_COOLDOWN_MS ago, and the workflow (`source`) hasn't changed since. A changed workflow
 * (say, fixed after the decline's reason) is a new proposal, so it can be asked for at once.
 */
export const inCooldown = (row, source, now = Date.now()) => row?.status === REQUEST_STATUS.DECLINED
    && Boolean(row.decided_at) && now - Date.parse(row.decided_at) < REQUEST_COOLDOWN_MS
    && !copyDiffers(row, source);

// ── Requesters ─────────────────────────────────────────────────────────────

const keyOf = (caseId, workflowId) => `${caseId}:${workflowId}`;
const requestKey = (row) => keyOf(row.case, row.workflow);
const requestWhere = (caseId, workflowId) => ({
    and: [{ case: { equals: Number(caseId) } }, { workflow: { equals: String(workflowId) } }],
});

/** Requesters of each request in `rows` (all on cases in `rows`): a Map from request to subs, oldest first. */
export async function requestersByRequest(rows) {
    const caseIds = [...new Set(rows.map((r) => Number(r.case)))];
    const found = caseIds.length
        ? await findAll(CASE_WORKFLOW_REQUESTERS, { case: { in: caseIds } }, 'createdAt')
        : [];
    const byKey = new Map();
    for (const r of found) {
        const key = keyOf(r.case, r.workflow);
        byKey.set(key, [...(byKey.get(key) || []), String(r.user_sub)]);
    }
    return new Map(rows.map((row) => [row, byKey.get(requestKey(row)) || []]));
}

/** The source workflow ids `sub` has asked for on a case. */
export async function requestedBy(caseId, sub) {
    const mine = await findAll(CASE_WORKFLOW_REQUESTERS, {
        and: [{ case: { equals: Number(caseId) } }, { user_sub: { equals: String(sub) } }],
    });
    return new Set(mine.map((r) => String(r.workflow)));
}

/**
 * Add `sub` to a request; asking twice changes nothing. Two tries at once both pass the check,
 * and the unique index refuses the second: a refusal with the row in place counts as done.
 */
export async function addRequester(caseId, workflowId, sub) {
    if ((await requestedBy(caseId, sub)).has(String(workflowId))) return;
    try {
        await getPayloadClient().create({
            collection: CASE_WORKFLOW_REQUESTERS,
            data: { case: Number(caseId), workflow: String(workflowId), user_sub: String(sub) },
        });
    } catch (err) {
        if (!(await requestedBy(caseId, sub)).has(String(workflowId))) throw err;
    }
}

/** Take `sub` off a request. Returns how many requesters are left. */
export async function removeRequester(caseId, workflowId, sub) {
    const payload = getPayloadClient();
    await payload.delete({
        collection: CASE_WORKFLOW_REQUESTERS,
        where: { and: [...requestWhere(caseId, workflowId).and, { user_sub: { equals: String(sub) } }] },
    });
    return (await findAll(CASE_WORKFLOW_REQUESTERS, requestWhere(caseId, workflowId))).length;
}

/** Forget everyone who asked for a request: once it's decided, or reopened after a decline. */
export const clearRequesters = (caseId, workflowId) =>
    getPayloadClient().delete({ collection: CASE_WORKFLOW_REQUESTERS, where: requestWhere(caseId, workflowId) });

/** A case-workflows row by id, only if it belongs to `caseId`. */
export async function loadCaseWorkflowRow(caseId, rowId) {
    const row = isDocId(rowId)
        ? await getPayloadClient().findByID({ collection: CASE_WORKFLOWS, id: rowId, depth: 0, disableErrors: true })
        : null;
    if (!row || String(row.case) !== String(caseId)) throw NotFoundError.fromKey('workflow.request_not_found');
    return row;
}

/**
 * Who of `subs` may still ask: anyone who has left the case, or is now read_only, is left out.
 * Read-time only: their rows go when the request is decided.
 */
async function stillMembers(subs, caseDoc) {
    const roles = await Promise.all(subs.map((sub) => (caseDoc ? getCaseRoleForSub(caseDoc, sub).catch(() => null) : null)));
    return subs.filter((_, i) => canRequest(roles[i]));
}

const displayName = async (sub) => kcDisplayName(await getKeycloakUser(sub).catch(() => null)) || null;

/**
 * Pending rows as admins see them, with requester names. A request nobody in the case is
 * asking for any more isn't shown; it's reused if someone asks again.
 */
export async function describeRequests(rows, caseById) {
    const pending = rows.filter(isPending);
    const sourceIds = [...new Set(pending.map((r) => r.workflow))];
    const [publicIds, requesters] = await Promise.all([
        sourceIds.length
            ? findAll(WORKFLOWS, { id: { in: sourceIds } }).then((docs) => new Set(docs.filter((d) => d.visibility === VISIBILITY.PUBLIC).map((d) => String(d.id))))
            : new Set(),
        requestersByRequest(pending),
    ]);
    const described = await Promise.all(pending.map(async (row) => {
        const caseDoc = caseById.get(String(row.case));
        const subs = await stillMembers(requesters.get(row), caseDoc);
        if (!subs.length) return null;
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

/**
 * A request has been decided: tell each requester still in the case the outcome (someone who
 * has left isn't told, so they don't learn the case's title), then forget who asked.
 * Never throws for a notification (createNotification doesn't).
 */
export async function decideRequesters(row, caseDoc, outcome, reason = '') {
    const subs = await stillMembers((await requestersByRequest([row])).get(row), caseDoc);
    await notifyRequesters(subs, row, caseDoc, outcome, reason);
    await clearRequesters(row.case, row.workflow);
}

function notifyRequesters(subs, row, caseDoc, outcome, reason) {
    const caseTitle = caseDoc?.title || 'a case';
    const approved = outcome === REQUEST_STATUS.APPROVED;
    return Promise.all(subs.map((userId) => createNotification({
        userId,
        type: approved ? 'workflow_request_approved' : 'workflow_request_declined',
        title: approved
            ? `"${row.name}" is now available in "${caseTitle}"`
            : `"${row.name}" wasn't added to "${caseTitle}"`,
        body: approved ? null : (reason || null),
        caseId: String(caseDoc?.id ?? row.case),
    })));
}
