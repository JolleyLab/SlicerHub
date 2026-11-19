/**
 * Documents a user owns (`owner_id` = Keycloak sub) and may make `public`: anyone can view a
 * public one, only the owner can change it. Used by workflows; meant for any such collection.
 */

import { getPayloadClient } from '../payload/index.js';
import { ForbiddenError, NotFoundError } from './errors.js';
import { isDocId } from './validation.js';

/** The requester's Keycloak sub; owned documents need one. */
export function requireOwnerId(req) {
    const sub = req.user?.keycloakSub;
    if (!sub) throw ForbiddenError.fromKey('owned_doc.identity_required');
    return sub;
}

export const isOwner = (doc, req) => Boolean(req.user?.keycloakSub) && doc?.owner_id === req.user.keycloakSub;

export const canView = (doc, req) => doc?.visibility === 'public' || isOwner(doc, req);

/**
 * Load a document the requester may view (`write: false`) or change (`write: true`, owner only).
 * Someone else's private document is reported as not found, so its existence isn't revealed.
 */
export async function loadOwnedDoc(collection, id, req, { write = true } = {}) {
    if (!isDocId(id)) throw NotFoundError.fromKey('owned_doc.not_found');
    const doc = await getPayloadClient().findByID({ collection, id, depth: 0, disableErrors: true });
    if (!doc || !canView(doc, req)) throw NotFoundError.fromKey('owned_doc.not_found');
    if (write && !isOwner(doc, req)) throw ForbiddenError.fromKey('owned_doc.owner_only');
    return doc;
}
