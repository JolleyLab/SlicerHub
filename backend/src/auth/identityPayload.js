import { findDirectusLinkForUser } from './identityStore.js';
import { isDirectusLinkRequired } from './requireDirectusLink.js';

/**
 * Identity payload for /me and login — FE uses this to gate Settings etc.
 */
export function buildIdentityPayload(userId) {
    const link = userId != null ? findDirectusLinkForUser(userId) : null;
    return {
        directusLinked: Boolean(link),
        directusUserId: link?.external_id || null,
        directusLinkRequired: isDirectusLinkRequired()
    };
}
