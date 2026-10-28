/**
 * Gate controlling access to account settings.
 * Originally tied to whether a Directus identity link existed; under Keycloak
 * the gate is never required so canAccessAccountSettings() always returns true.
 *
 * TODO: remove this file (and its callers) once the Directus provider is retired.
 */

let gate = {
    required: false,
    linked: false
};

/**
 * @deprecated Directus-era: sets the link-required gate from the login/me response.
 * For Keycloak auth `required` is always false, making this a no-op.
 * Remove when Directus is retired.
 */
export function setDirectusLinkGate({ required, linked } = {}) {
    gate = {
        required: Boolean(required),
        linked: Boolean(linked)
    };
}

/**
 * @deprecated Directus-era: clears the gate on logout.
 * Remove when Directus is retired.
 */
export function clearDirectusLinkGate() {
    gate = { required: false, linked: false };
}

/** Returns true when the current user may open account settings. */
export function canAccessAccountSettings() {
    if (!gate.required) return true;
    return gate.linked;
}
