/**
 * Shared gate: when Directus link is required for collab, Settings (and similar
 * account surfaces) require auth_identity_links too.
 * Populated from /api/auth/me (and login) by slicer-app.
 */

let gate = {
    required: false,
    linked: false
};

export function setDirectusLinkGate({ required, linked } = {}) {
    gate = {
        required: Boolean(required),
        linked: Boolean(linked)
    };
}

export function clearDirectusLinkGate() {
    gate = { required: false, linked: false };
}

/** Settings / profile when Directus is part of the product path. */
export function canAccessAccountSettings() {
    if (!gate.required) return true;
    return gate.linked;
}
