/**
 * Registration requests stored in the Payload `registration-requests` collection (Postgres).
 * Users submit a request before any Keycloak account is created.
 * An OrgAdmin approves or rejects; approval generates a one-time completion token
 * the admin shares via email.
 */

import crypto from 'crypto';
import config from '../config/index.js';
import { getPayloadClient } from '../payload/index.js';

const COLLECTION = 'registration-requests';

export const REG_STATUS = Object.freeze({
    PENDING:   'pending',
    APPROVED:  'approved',
    REJECTED:  'rejected',
    COMPLETED: 'completed',
});

const TOKEN_TTL_DAYS = 7;

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
        createdAt:    row.createdAt    || null,
        decidedAt:    row.reviewed_at  || null,
        reviewerName: null,
    };
}

export async function createRegistrationRequest({ email, firstName, lastName, affiliation, intendedUse }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('Email is required');

    const existing = await findOpenByEmail(normalized);
    if (existing) {
        const err = new Error('A registration request for this email already exists');
        err.code = 'DUPLICATE_REGISTRATION';
        throw err;
    }

    const payload = getPayloadClient();
    const doc = await payload.create({
        collection: COLLECTION,
        data: {
            email:        normalized,
            first_name:   String(firstName   || '').trim(),
            last_name:    String(lastName    || '').trim(),
            affiliation:  String(affiliation || '').trim(),
            intended_use: String(intendedUse || '').trim(),
            status:       REG_STATUS.PENDING,
        },
    });
    return toRegistrationRequestDTO(doc);
}

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

/**
 * Approve: store hashed token + expiry. Returns the raw token for the approval email.
 * reviewerSub is the Keycloak sub of the approving admin (for audit trail).
 */
export async function approveRequest(id, asAdmin = false, reviewerSub = null) {
    const rawToken   = crypto.randomBytes(32).toString('base64url');
    const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt  = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const reviewedAt = new Date().toISOString();

    const payload = getPayloadClient();
    await payload.update({
        collection: COLLECTION,
        id,
        data: {
            status:                        REG_STATUS.APPROVED,
            completion_token_hash:         tokenHash,
            completion_token_expires_at:   expiresAt,
            is_org_admin:                  asAdmin === true,
            reviewed_by:                   reviewerSub || null,
            reviewed_at:                   reviewedAt,
        },
    });

    const base = config.publicAppUrl || 'http://localhost:8000';
    return {
        token:         rawToken,
        completionUrl: `${base}/?register=${encodeURIComponent(rawToken)}`,
        expiresAt,
    };
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

/** Find a pending-approved request by its raw token; returns null if missing, expired, or already used. */
export async function findByToken(rawToken) {
    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    const payload = getPayloadClient();
    const result = await payload.find({
        collection: COLLECTION,
        where: {
            and: [
                { completion_token_hash: { equals: tokenHash } },
                { status:               { equals: REG_STATUS.APPROVED } },
            ],
        },
        limit: 1,
    });
    const row = result.docs[0] ?? null;
    if (!row) return null;

    const expires = row.completion_token_expires_at;
    if (expires && new Date(expires).getTime() < Date.now()) return null;

    return toRegistrationRequestDTO(row);
}

export async function markCompleted(id) {
    const payload = getPayloadClient();
    await payload.update({
        collection: COLLECTION,
        id,
        data: { status: REG_STATUS.COMPLETED },
    });
}
