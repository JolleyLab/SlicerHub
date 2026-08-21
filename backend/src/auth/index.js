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
 * Opt in with AUTH_STORE_PROVIDER_TOKENS=true when a feature must call the IdP as the end user.
 *
 * AUTH_DEV_RELAXED=true (non-production only): softer login rate limits, longer idle default,
 * longer "remember device" TTL — not a full MFA kill-switch (IdP still enforces first OTP).
 */

import config from '../config/index.js';
import { ValidationError } from '../utils/errors.js';
import { localProvider } from './providers/local.js';
import { directusProvider } from './providers/directus.js';
import { issueAppSession, destroyAppSession, clearAuthCookie } from './session.js';
import { clearProviderTokens, clearProviderTokensForUser } from './identityStore.js';
import { isDirectusLinkRequired } from './requireDirectusLink.js';
import { deleteAllUserSessions } from '../middleware/authMiddleware.js';
import {
    DEVICE_COOKIE,
    upsertTrustedDevice,
    setDeviceCookie,
    revokeTrustedDevicesForUser
} from './trustedDevices.js';

const PROVIDERS = {
    local: localProvider,
    directus: directusProvider
};

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
    const webauthnOn = config.auth?.webauthn?.enabled === true;
    const methods = ['password'];
    if (webauthnOn) methods.push('webauthn');

    return {
        provider,
        methods,
        registrationEnabled,
        /** product direction: collab users map 1:1 to Directus */
        identityMode: config.auth?.identityMode || 'directus-linked',
        requireDirectusLink: isDirectusLinkRequired(),
        identityLabel: provider === 'directus' ? 'Email' : 'Username or email',
        identityPlaceholder: provider === 'directus'
            ? 'you@example.com'
            : 'Username or email',
        devRelaxed: config.auth?.devRelaxed === true,
        rememberDeviceEnabled: provider === 'directus',
        webauthn: webauthnOn
            ? {
                enabled: true,
                rpId: config.auth.webauthn.rpID
            }
            : { enabled: false }
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
    const rememberDevice = credentials?.rememberDevice === true
        || credentials?.remember_device === true;
    const deviceToken = req.cookies?.[DEVICE_COOKIE] || null;

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
        otp,
        deviceToken
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
    }

    // Remember device: keep encrypted refresh for MFA re-prompt skip (cookie httpOnly).
    const refresh = result.externalTokens?.refreshToken || result.externalTokens?.refresh_token;
    if (providerName === 'directus' && refresh && (rememberDevice || deviceToken || result.usedTrustedDevice)) {
        try {
            const raw = upsertTrustedDevice({
                provider: providerName,
                identity,
                userId: result.user.id,
                refreshToken: refresh,
                existingRawToken: deviceToken
            });
            setDeviceCookie(res, raw);
        } catch (err) {
            console.warn('Trusted device store failed:', err.message);
        }
    }

    return {
        user,
        provider: providerName
    };
}

/**
 * End this browser session (app JWT + any stored provider tokens).
 * Device trust cookie is kept (like a remembered browser).
 */
export function logoutCurrentSession(req, res) {
    const jti = destroyAppSession(req, res);
    if (jti) {
        clearProviderTokens(jti);
    }
}

/**
 * Drop all app sessions for this user (+ provider tokens + trusted devices).
 */
export function logoutAllSessions(userId, res) {
    deleteAllUserSessions(userId);
    clearProviderTokensForUser(userId);
    revokeTrustedDevicesForUser(userId);
    clearAuthCookie(res);
}
