/**
 * Registration requests stored in the Payload `registration-requests` collection (Postgres).
 *
 * Each request is a Keycloak account (sign-up page or hospital SSO) that has no app-user
 * role yet (approval gate); approval grants the role. Status 'approved' only appears on
 * records from the old app-run sign-up, which no longer exists.
 */

import { getPayloadClient } from '../payload/index.js';

const COLLECTION = 'registration-requests';

export const REG_STATUS = Object.freeze({
    PENDING:   'pending',
    APPROVED:  'approved',
    REJECTED:  'rejected',
    COMPLETED: 'completed',
});

export function toRegistrationRequestDTO(row) {
    if (!row) return null;
    return {
        id:           String(row.id),
        email:        row.email        || '',
        firstName:    row.first_name   || '',
        lastName:     row.last_name    || '',
        affiliation:  row.affiliation  || '',
        intendedUse:  row.intended_use || '',
        status:       row.status       || REG_STATUS.PENDING,
        isOrgAdmin:   row.is_org_admin === true,
        keycloakSub:  row.keycloak_sub || null,
        hasAccount:   Boolean(row.keycloak_sub),
        createdAt:    row.createdAt    || null,
        decidedAt:    row.reviewed_at  || null,
        reviewerName: null,
    };
}

/**
 * Make sure an account waiting for approval has a pending review item.
 * Returns { request, created }.
 */
export async function ensureAccountRequest({ kcSub, email, firstName, lastName, affiliation = '', intendedUse = '' }) {
    const sub = String(kcSub || '').trim();
    if (!sub) throw new Error('kcSub is required');
    const payload = getPayloadClient();

    const bySub = await payload.find({
        collection: COLLECTION,
        where: {
            and: [
                { keycloak_sub: { equals: sub } },
                { status: { equals: REG_STATUS.PENDING } },
            ],
        },
        limit: 1,
    });
    if (bySub.docs[0]) return { request: toRegistrationRequestDTO(bySub.docs[0]), created: false };

    const normalized = String(email || '').trim().toLowerCase();
    const open = normalized ? await findOpenByEmail(normalized) : null;
    if (open) {
        // An earlier form request for the same email: attach the account to it.
        const doc = await payload.update({
            collection: COLLECTION,
            id: open.id,
            data: { keycloak_sub: sub, status: REG_STATUS.PENDING },
        });
        return { request: toRegistrationRequestDTO(doc), created: false };
    }

    const doc = await payload.create({
        collection: COLLECTION,
        data: {
            email:        normalized,
            first_name:   String(firstName || '').trim(),
            last_name:    String(lastName  || '').trim(),
            affiliation:  String(affiliation || '').trim().slice(0, 200),
            intended_use: String(intendedUse || '').trim().slice(0, 2000),
            keycloak_sub: sub,
            status:       REG_STATUS.PENDING,
        },
    });
    return { request: toRegistrationRequestDTO(doc), created: true };
}

/** Approve an account request: the role grant happens in the route; this records the decision. */
export async function markAccountApproved(id, asAdmin = false, reviewerSub = null) {
    const payload = getPayloadClient();
    await payload.update({
        collection: COLLECTION,
        id,
        data: {
            status:       REG_STATUS.COMPLETED,
            is_org_admin: asAdmin === true,
            reviewed_by:  reviewerSub || null,
            reviewed_at:  new Date().toISOString(),
        },
    });
}

/** An open (pending, or approved by the old flow) request for this email, if any. */
export async function findOpenByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    const payload = getPayloadClient();
    const result = await payload.find({
        collection: COLLECTION,
        where: {
            and: [
                { email:  { equals: normalized } },
                { status: { in: [REG_STATUS.PENDING, REG_STATUS.APPROVED] } },
            ],
        },
        limit: 1,
    });
    return toRegistrationRequestDTO(result.docs[0] ?? null);
}

export async function listRecentlyDecided(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const payload = getPayloadClient();
    const result = await payload.find({
        collection: COLLECTION,
        where: {
            and: [
                { status:      { in: [REG_STATUS.APPROVED, REG_STATUS.REJECTED, REG_STATUS.COMPLETED] } },
                { reviewed_at: { greater_than_equal: since } },
            ],
        },
        sort: '-reviewed_at',
        limit: 200,
    });
    return result.docs.map(toRegistrationRequestDTO);
}

export async function listPending() {
    const payload = getPayloadClient();
    const result = await payload.find({
        collection: COLLECTION,
        where: { status: { equals: REG_STATUS.PENDING } },
        sort: 'createdAt',
        limit: 100,
    });
    return result.docs.map(toRegistrationRequestDTO);
}

export async function getById(id) {
    const payload = getPayloadClient();
    try {
        const doc = await payload.findByID({ collection: COLLECTION, id });
        return toRegistrationRequestDTO(doc);
    } catch {
        return null;
    }
}

export async function rejectRequest(id, reviewerSub = null) {
    const payload = getPayloadClient();
    await payload.update({
        collection: COLLECTION,
        id,
        data: {
            status:      REG_STATUS.REJECTED,
            reviewed_by: reviewerSub || null,
            reviewed_at: new Date().toISOString(),
        },
    });
}
