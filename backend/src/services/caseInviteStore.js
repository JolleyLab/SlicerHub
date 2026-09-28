/**
 * Case invites, stored in Directus in the `case_invite` collection (see docs/directus-schema.md).
 * One record per invite, for both kinds: `existing` (the invitee already has an account) and `signup`
 * (an emailed link creates one). All access is by the service token; callers authorize the actor first.
 *
 * Status: pending_approval (waiting for a case admin), pending_signup (link sent), approved,
 * rejected (declined by an admin, including a link that was withdrawn), accepted (link redeemed).
 * A link that has run out is not a stored state: it reads as "expired" until it is deleted.
 */

import { CASE_COLLAB_ROLES, parseCaseRole } from './caseCollaborators.js';
import { directusFetch } from './directus.js';

const COLLECTION = 'case_invite';

export const INVITE_STATUS = Object.freeze({
    PENDING_APPROVAL: 'pending_approval',
    PENDING_SIGNUP: 'pending_signup',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    ACCEPTED: 'accepted'
});

/** What the API reports for a signup link past its time; never stored. */
const EXPIRED = 'expired';

/** Never includes token_hash: it is only ever used to look an invite up. */
const FIELDS = [
    'id', 'kind', 'status', 'case.id', 'case.title', 'invitee_email', 'invitee_user.id', 'invitee_user.first_name', 'invitee_user.last_name', 'invitee_user.email',
    'proposed_role',
    'inviter.id', 'inviter.first_name', 'inviter.last_name', 'inviter.email',
    'expires_at', 'resolved_at',
    'resolved_by.id', 'resolved_by.first_name', 'resolved_by.last_name', 'resolved_by.email',
    'accepted_user', 'date_created'
].join(',');

const OPEN_STATUSES = [INVITE_STATUS.PENDING_APPROVAL, INVITE_STATUS.PENDING_SIGNUP];

/**
 * Directus "Date Time" fields come back without a timezone ("2026-09-25T19:52:34") but hold UTC.
 * JavaScript would read that as local time, so mark it UTC. Values that already say so are unchanged.
 */
export function utcIso(value) {
    if (!value) return null;
    const text = String(value);
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
}

/** A person's display name from an expanded Directus user, or null when only an id came back. */
function personName(user) {
    if (!user || typeof user !== 'object') return null;
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.email || null;
}

function relationId(value) {
    if (value == null || value === '') return null;
    return String(value && typeof value === 'object' ? value.id : value);
}

export function mapInvite(row) {
    if (!row) return null;
    const kind = row.kind === 'signup' ? 'signup' : 'existing';
    const expiresAt = utcIso(row.expires_at);
    const expired = kind === 'signup'
        && row.status === INVITE_STATUS.PENDING_SIGNUP
        && expiresAt
        && new Date(expiresAt).getTime() < Date.now();
    return {
        id: String(row.id),
        kind,
        caseId: relationId(row.case),
        caseTitle: row.case && typeof row.case === 'object' ? row.case.title || null : null,
        inviteeDirectusUserId: relationId(row.invitee_user),
        inviteeEmail: row.invitee_email,
        inviteeName: personName(row.invitee_user) || row.invitee_email,
        // An unusable stored role reads as read only, the least access.
        proposedRole: parseCaseRole(row.proposed_role) || CASE_COLLAB_ROLES.READ_ONLY,
        inviterDirectusUserId: relationId(row.inviter),
        inviterName: personName(row.inviter),
        resolvedByDirectusUserId: relationId(row.resolved_by),
        resolvedByName: personName(row.resolved_by),
        status: expired ? EXPIRED : row.status,
        expiresAt,
        createdAt: utcIso(row.date_created),
        resolvedAt: utcIso(row.resolved_at)
    };
}

export function createCaseInviteStore({ fetchDirectus = directusFetch } = {}) {
    async function list(query) {
        const payload = await fetchDirectus(`/items/${COLLECTION}`, {
            query: { fields: FIELDS, sort: '-date_created', limit: '-1', ...query }
        });
        return (payload?.data || []).map(mapInvite);
    }

    async function getInvite(id) {
        const key = String(id || '').trim();
        if (!key) return null;
        try {
            const payload = await fetchDirectus(`/items/${COLLECTION}/${encodeURIComponent(key)}`, {
                query: { fields: FIELDS }
            });
            return mapInvite(payload?.data);
        } catch (err) {
            // Directus answers FORBIDDEN (or not found) for an id that does not exist, whatever status
            // the request wrapper gives it; an unknown invite is just absent.
            const code = err?.directusExtensions?.code;
            if (code === 'FORBIDDEN' || code === 'RECORD_NOT_FOUND' || err?.statusCode === 404) return null;
            throw err;
        }
    }

    async function createInvite({
        kind, status, caseId, inviteeEmail, inviteeUserId = null,
        proposedRole, inviterId, tokenHash = null, expiresAt = null, resolvedAt = null, resolvedById = null
    }) {
        const payload = await fetchDirectus(`/items/${COLLECTION}`, {
            method: 'POST',
            query: { fields: FIELDS },
            body: {
                kind,
                status,
                case: String(caseId),
                invitee_email: String(inviteeEmail).toLowerCase(),
                invitee_user: inviteeUserId ? String(inviteeUserId) : null,
                proposed_role: proposedRole,
                inviter: String(inviterId),
                token_hash: tokenHash,
                expires_at: expiresAt,
                resolved_at: resolvedAt,
                resolved_by: resolvedById ? String(resolvedById) : null
            }
        });
        return mapInvite(payload?.data);
    }

    async function updateInvite(id, patch) {
        const payload = await fetchDirectus(`/items/${COLLECTION}/${encodeURIComponent(String(id))}`, {
            method: 'PATCH',
            query: { fields: FIELDS },
            body: patch
        });
        return mapInvite(payload?.data);
    }

    async function deleteInvite(id) {
        await fetchDirectus(`/items/${COLLECTION}/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    }

    /** Invites of a case that are still waiting: on an admin's approval or on the invitee's signup. */
    async function listOpenForCase(caseId) {
        return list({
            'filter[case][_eq]': String(caseId),
            'filter[status][_in]': OPEN_STATUSES.join(',')
        });
    }

    /** The newest invites on the given cases, whatever their state. */
    async function listRecentForCases(caseIds, limit = 50) {
        const ids = [...new Set((caseIds || []).map(String))];
        if (!ids.length) return [];
        return list({ 'filter[case][_in]': ids.join(','), limit: String(limit) });
    }

    /** Every invite, on any case, waiting for an admin's decision. */
    async function listAwaitingApproval() {
        return list({ 'filter[status][_eq]': INVITE_STATUS.PENDING_APPROVAL });
    }

    async function findOpenExistingUserInvite(caseId, inviteeUserId) {
        const [invite] = await list({
            'filter[case][_eq]': String(caseId),
            'filter[invitee_user][_eq]': String(inviteeUserId),
            'filter[status][_eq]': INVITE_STATUS.PENDING_APPROVAL,
            limit: '1'
        });
        return invite || null;
    }

    async function findOpenByEmail(caseId, email) {
        const [invite] = await list({
            'filter[case][_eq]': String(caseId),
            'filter[invitee_email][_eq]': String(email).toLowerCase(),
            'filter[status][_in]': OPEN_STATUSES.join(','),
            limit: '1'
        });
        return invite || null;
    }

    /** The signup invite whose link carried this token hash, or null. */
    async function findByTokenHash(tokenHash) {
        const [invite] = await list({ 'filter[token_hash][_eq]': String(tokenHash), limit: '1' });
        return invite || null;
    }

    /**
     * Delete signup invites whose link has run out, so they neither clutter the collection nor keep a
     * working token. Returns the ids so the caller can clear the notifications about them.
     */
    async function expireStaleSignupInvites(caseId = null) {
        const stale = await list({
            'filter[status][_eq]': INVITE_STATUS.PENDING_SIGNUP,
            'filter[expires_at][_lt]': new Date().toISOString(),
            ...(caseId ? { 'filter[case][_eq]': String(caseId) } : {})
        });
        for (const invite of stale) await deleteInvite(invite.id);
        return stale.map((invite) => invite.id);
    }

    return {
        getInvite,
        createInvite,
        updateInvite,
        deleteInvite,
        listOpenForCase,
        listRecentForCases,
        listAwaitingApproval,
        findOpenExistingUserInvite,
        findOpenByEmail,
        findByTokenHash,
        expireStaleSignupInvites
    };
}

const store = createCaseInviteStore({ fetchDirectus: (...args) => directusFetch(...args) });

export const {
    getInvite,
    createInvite,
    updateInvite,
    deleteInvite,
    listOpenForCase,
    listRecentForCases,
    listAwaitingApproval,
    findOpenExistingUserInvite,
    findOpenByEmail,
    findByTokenHash,
    expireStaleSignupInvites
} = store;
