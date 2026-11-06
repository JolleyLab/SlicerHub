/**
 * Authentication façade (product BFF).
 *
 * Hard contracts (do not break without migration):
 *   - Browser talks only to this app (/api/auth/*).
 *   - Product session = app JWT + httpOnly cookie (session.js).
 *   - Identity providers prove who the human is; they do not become the product session.
 *
 * Expand by adding providers/* and identityStore features — not by branching routes/UI.
 *
 * Sign-in is Keycloak's own page (OpenID Connect code flow + PKCE, auth/oidc.js);
 * the app never sees passwords. docs/redirect-login-and-sessions-design.md
 *
 * Default: Do not persist IdP tokens after login (identity mapping only).
 * Opt in with AUTH_STORE_PROVIDER_TOKENS=true when a feature must call the IdP as the end user
 * (e.g. Cases call-as-user).
 *
 * AUTH_DEV_RELAXED=true (non-production only): shows a dev banner; Keycloak still applies
 * its own lockout and MFA rules.
 */

import config from '../config/index.js';
import { keycloakProvider } from './providers/keycloak.js';
import { destroyAppSession, clearAuthCookie } from './session.js';
import { clearProviderTokens, clearProviderTokensForUser } from './identityStore.js';
import { deleteAllUserSessions } from '../middleware/authMiddleware.js';

const PROVIDERS = {
    keycloak: keycloakProvider
};

/** Clear leftover remember-device cookies from older builds. */
function clearLegacyDeviceCookie(res) {
    const secure = process.env.COOKIE_SECURE === 'true'
        || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
    res.clearCookie('auth_device', {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/'
    });
}

export function getAuthProviderName() {
    const raw = String(config.auth?.provider || process.env.AUTH_PROVIDER || 'local')
        .trim()
        .toLowerCase();
    return PROVIDERS[raw] ? raw : 'local';
}

export function getAuthProvider() {
    return PROVIDERS[getAuthProviderName()];
}

/**
 * Public flags for the SPA (no secrets).
 */
export function getPublicAuthConfig() {
    const provider = getAuthProviderName();

    // Sign-in, registration and password reset all happen on Keycloak's pages
    // (/api/auth/login/start); the SPA needs no more than this.
    return {
        provider,
        devRelaxed: config.auth?.devRelaxed === true,
    };
}

/**
 * End this browser session (app JWT + session-scoped provider tokens).
 * Keeps the Directus link cookie so Cases call-as-user can re-attach on the next
 * request in this browser until logout-all or cookie expiry.
 */
export function logoutCurrentSession(req, res) {
    const jti = destroyAppSession(req, res);
    if (jti) {
        clearProviderTokens(jti);
    }
    clearLegacyDeviceCookie(res);
}

/**
 * Drop all app sessions for this user (+ provider tokens).
 */
export function logoutAllSessions(userId, res) {
    deleteAllUserSessions(userId);
    clearProviderTokensForUser(userId);
    clearAuthCookie(res);
    clearLegacyDeviceCookie(res);
}
