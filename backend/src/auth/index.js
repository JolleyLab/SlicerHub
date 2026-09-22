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
 *   AUTH_PROVIDER=local     → SQLite credential check
 *   AUTH_PROVIDER=directus  → BFF password login to Directus, map to local user
 *
 * Default: Do not persist IdP tokens after login (identity mapping only).
 * Opt in with AUTH_STORE_PROVIDER_TOKENS=true when a feature must call the IdP as the end user
 * (e.g. Cases call-as-user).
 *
 * AUTH_DEV_RELAXED=true (non-production only): softer login rate limits, longer idle default —
 * not a full MFA kill-switch (IdP still enforces OTP when required).
 */

import config from '../config/index.js';
import { ValidationError } from '../utils/errors.js';
import { localProvider } from './providers/local.js';
import { directusProvider } from './providers/directus.js';
import { issueAppSession, destroyAppSession, clearAuthCookie } from './session.js';
import { clearProviderTokens, clearProviderTokensForUser } from './identityStore.js';
import { setDirectusLinkCookie, clearDirectusLinkCookie } from './directusLinkCookie.js';
import { isDirectusLinkRequired } from './requireDirectusLink.js';
import { deleteAllUserSessions } from '../middleware/authMiddleware.js';

const PROVIDERS = {
    local: localProvider,
    directus: directusProvider
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

export function shouldStoreProviderTokens() {
    return config.auth?.storeProviderTokens === true;
}

/**
 * Public flags for the SPA (no secrets).
 */
export function getPublicAuthConfig() {
    const provider = getAuthProviderName();
    const registrationEnv = process.env.REGISTRATION_ENABLED;
    const registrationEnabled = provider === 'local' && registrationEnv !== 'false';

    return {
        provider,
        methods: ['password'],
        registrationEnabled,
        /** product direction: collab users map 1:1 to Directus */
        identityMode: config.auth?.identityMode || 'directus-linked',
        requireDirectusLink: isDirectusLinkRequired(),
        identityLabel: provider === 'directus' ? 'Email' : 'Username or email',
        identityPlaceholder: provider === 'directus'
            ? 'you@example.com'
            : 'Username or email',
        devRelaxed: config.auth?.devRelaxed === true
    };
}

/**
 * Authenticate against the active provider and issue an app session cookie.
 * @returns {{ user: object, provider: string } | null}
 */
export async function loginWithProvider(req, res, credentials) {
    const identity = String(credentials?.identity || credentials?.username || credentials?.email || '').trim();
    const password = String(credentials?.password || '');
    const otp = credentials?.otp != null ? String(credentials.otp) : undefined;

    if (!identity || !password) {
        throw new ValidationError('Identity and password are required');
    }

    const providerName = getAuthProviderName();
    const provider = getAuthProvider();

    if (typeof provider.login !== 'function') {
        throw new ValidationError(`Auth provider "${providerName}" cannot login`);
    }

    const result = await provider.login({
        identity,
        password,
        otp
    });
    if (!result?.user) {
        return null;
    }

    const { user, sessionPayload } = issueAppSession(req, res, result.user);

    if (
        shouldStoreProviderTokens()
        && result.externalTokens
        && typeof provider.storeSessionTokens === 'function'
    ) {
        provider.storeSessionTokens(sessionPayload.jti, result.user.id, result.externalTokens);
        if (providerName === 'directus') {
            setDirectusLinkCookie(res, {
                userId: result.user.id,
                accessToken: result.externalTokens.accessToken || result.externalTokens.access_token,
                refreshToken: result.externalTokens.refreshToken || result.externalTokens.refresh_token,
                expiresAt: result.externalTokens.expiresAt || null,
                expires: result.externalTokens.expires
            });
        }
    }

    clearLegacyDeviceCookie(res);

    return {
        user,
        provider: providerName
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
 * Drop all app sessions for this user (+ provider tokens + Directus link).
 */
export function logoutAllSessions(userId, res) {
    deleteAllUserSessions(userId);
    clearProviderTokensForUser(userId);
    clearAuthCookie(res);
    clearDirectusLinkCookie(res);
    clearLegacyDeviceCookie(res);
}
