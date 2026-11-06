/**
 * Keycloak identity mapping: realm roles → app role and approval, ID-token claims →
 * the app user. Sign-in is Keycloak's own page (auth/oidc.js); the password grant is
 * off for this client.
 */

import { AppError } from '../../utils/errors.js';

const PROVIDER = 'keycloak';

// Map Keycloak realm role names to local role values.
// Priority: most-privileged role wins.
/**
 * Approval gate: an account may use SlicerHub only with app-user, or an admin role
 * (admins are approved by definition). Accounts without one — e.g. a first hospital
 * SSO sign-in, or self-registration — wait for a reviewer.
 * docs/redirect-login-and-sessions-design.md ("Approval gate").
 */
export const APP_ACCESS_ROLES = Object.freeze(['app-user', 'app-org-admin', 'app-admin']);

export function hasAppAccess(roles) {
    return Array.isArray(roles) && roles.some((r) => APP_ACCESS_ROLES.includes(r));
}

export function pickRole(roles) {
    if (!Array.isArray(roles)) return 'user';
    if (roles.includes('app-admin'))     return 'admin';
    if (roles.includes('app-org-admin')) return 'org-admin';
    return 'user';
}

export function resolveLocalUser(claims) {
    const externalId = String(claims?.sub || '').trim();
    if (!externalId) throw new AppError('Keycloak token missing sub claim', 502);

    const email = String(claims?.email || '').trim().toLowerCase();
    if (!email) throw new AppError('Keycloak token missing email claim', 502);

    return {
        id:          externalId,
        email,
        role:        pickRole(claims?.roles),
        approved:    hasAppAccess(claims?.roles),
        username:    buildUsername(claims, email),
        firstName:   String(claims?.given_name  || '').trim() || null,
        lastName:    String(claims?.family_name || '').trim() || null,
        keycloakSub: externalId,
    };
}

function buildUsername(claims, email) {
    const preferred = String(claims?.preferred_username || '').trim();
    if (preferred && !preferred.includes('@')) return preferred.slice(0, 40);
    return email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'user';
}

/** Provider name used by the auth façade (auth/index.js). Sign-in itself is auth/oidc.js. */
export const keycloakProvider = Object.freeze({ name: PROVIDER });
