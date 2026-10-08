/**
 * Registration requests stored in the Directus `pending_registration` collection.
 * Users submit a request before any Directus account is created.
 * An OrgAdmin approves or rejects; approval generates a one-time completion token
 * the admin shares manually (or via email once SMTP is configured).
 */

import crypto from 'crypto';
import config from '../config/index.js';
import { directusFetch } from './directus.js';

const COLLECTION = 'pending_registration';

export const REG_STATUS = Object.freeze({
    PENDING:  'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
});

const TOKEN_TTL_DAYS = 7;

const FIELDS = [
    'id', 'email', 'first_name', 'last_name', 'affiliation', 'intended_use',
    'status', 'is_org_admin', 'completion_token_expires_at', 'date_created'
].join(',');

// Extended fields for decided items — includes Directus auto-tracking fields.
// Requires `date_updated` (Date Updated) and `user_updated` (User Updated) fields
// on the pending_registration collection in Directus.
const DECIDED_FIELDS = FIELDS + ',date_updated,user_updated.first_name,user_updated.last_name';

export function toRegistrationRequestDTO(row) {
    if (!row) return null;
    const reviewer = row.user_updated;
    const reviewerName = reviewer
        ? [reviewer.first_name, reviewer.last_name].filter(Boolean).join(' ') || null
        : null;
    return {
        id:           String(row.id),
        email:        row.email,
        firstName:    row.first_name || '',
        lastName:     row.last_name  || '',
        affiliation:  row.affiliation || '',
        intendedUse:  row.intended_use || '',
        status:       row.status || REG_STATUS.PENDING,
        isOrgAdmin:   row.is_org_admin === true,
        createdAt:    row.date_created || null,
        decidedAt:    row.date_updated || null,
        reviewerName: reviewerName
    };
}

export async function createRegistrationRequest({ email, firstName, lastName, affiliation, intendedUse }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('Email is required');

    // Reject duplicate pending requests for the same email
    const existing = await findOpenByEmail(normalized);
    if (existing) {
        const err = new Error('A registration request for this email already exists');
        err.code = 'DUPLICATE_REGISTRATION';
        throw err;
    }

    const payload = await directusFetch(`/items/${COLLECTION}`, {
        method: 'POST',
        body: {
            email: normalized,
            first_name:   String(firstName   || '').trim(),
            last_name:    String(lastName    || '').trim(),
            affiliation:  String(affiliation || '').trim(),
            intended_use: String(intendedUse || '').trim(),
            status: REG_STATUS.PENDING
        }
    });
    return toRegistrationRequestDTO(payload?.data);
}

export async function findOpenByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    const payload = await directusFetch(`/items/${COLLECTION}`, {
        query: {
            'filter[email][_eq]': normalized,
            'filter[status][_in]': `${REG_STATUS.PENDING},${REG_STATUS.APPROVED}`,
            fields: FIELDS,
            limit: '1'
        }
    });
    const row = Array.isArray(payload?.data) ? payload.data[0] : null;
    return toRegistrationRequestDTO(row);
}

export async function listRecentlyDecided(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const payload = await directusFetch(`/items/${COLLECTION}`, {
        query: {
            'filter[status][_in]': `${REG_STATUS.APPROVED},${REG_STATUS.REJECTED}`,
            'filter[date_updated][_gte]': since,
            fields: DECIDED_FIELDS,
            sort: '-date_updated',
            limit: '200'
        }
    });
    return (Array.isArray(payload?.data) ? payload.data : []).map(toRegistrationRequestDTO);
}

export async function listPending() {
    const payload = await directusFetch(`/items/${COLLECTION}`, {
        query: {
            'filter[status][_eq]': REG_STATUS.PENDING,
            fields: FIELDS,
            sort: 'date_created',
            limit: '100'
        }
    });
    return (Array.isArray(payload?.data) ? payload.data : []).map(toRegistrationRequestDTO);
}

export async function getById(id) {
    const payload = await directusFetch(`/items/${COLLECTION}/${encodeURIComponent(id)}`, {
        query: { fields: FIELDS }
    });
    return toRegistrationRequestDTO(payload?.data);
}

/**
 * Approve: store hashed token + expiry, return the raw token (shown to admin once).
 * Pass userToken so Directus activity records the actual reviewer, not the service account.
 */
export async function approveRequest(id, asAdmin = false, userToken = null) {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    await directusFetch(`/items/${COLLECTION}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        accessToken: userToken || undefined,
        body: {
            status: REG_STATUS.APPROVED,
            completion_token_hash: tokenHash,
            completion_token_expires_at: expiresAt,
            is_org_admin: asAdmin === true
        }
    });

    const base = config.publicAppUrl || 'http://localhost:8000';
    return {
        token: rawToken,
        completionUrl: `${base}/?register=${encodeURIComponent(rawToken)}`,
        expiresAt
    };
}

/**
 * Soft-reject: set status to 'rejected' so the record remains for the audit trail.
 * Directus activity will record the reviewer when userToken is provided.
 */
export async function rejectRequest(id, userToken = null) {
    await directusFetch(`/items/${COLLECTION}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        accessToken: userToken || undefined,
        body: { status: REG_STATUS.REJECTED }
    });
}

/** Find a pending-approved request by its raw token; returns null if missing, expired, or already used. */
export async function findByToken(rawToken) {
    const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
    const payload = await directusFetch(`/items/${COLLECTION}`, {
        query: {
            'filter[completion_token_hash][_eq]': tokenHash,
            'filter[status][_eq]': REG_STATUS.APPROVED,
            fields: FIELDS + ',completion_token_hash',
            limit: '1'
        }
    });
    const row = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!row) return null;

    const expires = row.completion_token_expires_at;
    if (expires && new Date(expires).getTime() < Date.now()) return null;

    return toRegistrationRequestDTO(row);
}

/** Delete the record on completion — audit trail is preserved in directus_revisions. */
export async function markCompleted(id) {
    await directusFetch(`/items/${COLLECTION}/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}
