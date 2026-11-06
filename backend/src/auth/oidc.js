/**
 * Redirect login with Keycloak (OpenID Connect authorization code flow + PKCE),
 * run by the backend so Keycloak's tokens never reach the browser.
 * Design: docs/redirect-login-and-sessions-design.md ("Login flow").
 *
 * Keycloak has two addresses: browsers use the public one (<PUBLIC_APP_URL>/sso via
 * nginx) and the backend uses the internal one (KEYCLOAK_URL, the Docker network).
 * Keycloak's discovery document, fetched internally, already gives public URLs for the
 * browser-facing endpoints (authorization, end-session, issuer) and internal URLs for
 * the back-channel ones (token, JWKS), because KC_HOSTNAME_BACKCHANNEL_DYNAMIC is on.
 *
 * Token signatures are checked with `jose` (MIT) against Keycloak's published keys.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import config from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { resolveLocalUser } from './providers/keycloak.js';

// One cookie per sign-in in progress, named after its state, so sign-ins in two tabs
// don't overwrite each other. That happens routinely: Keycloak's verify-email link
// opens in a new tab while the first tab is still signing in.
export const TX_COOKIE_PREFIX = 'sh_oidc_tx_';
// The single-cookie name used before; cleared when seen.
export const LEGACY_TX_COOKIE = 'sh_oidc_tx';
// Most sign-ins kept in progress at once per browser (oldest dropped first).
export const MAX_TX_COOKIES = 5;

/** Cookie name for the sign-in with this state (a slice of the random state; not a secret from this browser). */
export function txCookieName(state) {
    const id = String(state || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
    return id ? `${TX_COOKIE_PREFIX}${id}` : null;
}
const TX_TTL_SECONDS = 10 * 60;
const TX_AUDIENCE = 'slicerhub-oidc-tx';
// Keycloak and the backend clocks may differ slightly.
const AUTH_TIME_SKEW_SECONDS = 30;
const METADATA_TTL_MS = 10 * 60 * 1000;
const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

function kc() {
    const { url, realm, clientId, clientSecret } = config.keycloak;
    if (!url || !clientSecret) {
        throw new AppError('Keycloak is not configured (KEYCLOAK_URL / KEYCLOAK_CLIENT_SECRET)', 503, null, 'keycloak.not_configured');
    }
    return { url, realm, clientId, clientSecret };
}

export function redirectUri() {
    return `${config.publicAppUrl}/api/auth/callback`;
}

// ── Provider metadata (cached) ────────────────────────────────────────────

let metadataCache = null; // { at, value }
const jwksByUri = new Map();

/** For tests: inject metadata/keys instead of fetching from Keycloak. */
export function _setProviderForTests({ metadata, jwks } = {}) {
    metadataCache = metadata ? { at: Date.now(), value: metadata } : null;
    jwksByUri.clear();
    if (metadata && jwks) jwksByUri.set(metadata.jwks_uri, jwks);
}

export async function getProviderMetadata() {
    if (metadataCache && Date.now() - metadataCache.at < METADATA_TTL_MS) return metadataCache.value;
    const { url, realm } = kc();
    const res = await fetch(`${url}/realms/${encodeURIComponent(realm)}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new AppError(`Keycloak discovery failed (${res.status})`, 502);
    const value = await res.json();
    for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (!value?.[key]) throw new AppError(`Keycloak discovery missing ${key}`, 502);
    }
    metadataCache = { at: Date.now(), value };
    return value;
}

function jwksFor(uri) {
    if (!jwksByUri.has(uri)) jwksByUri.set(uri, createRemoteJWKSet(new URL(uri)));
    return jwksByUri.get(uri);
}

// ── Helpers ───────────────────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const randomToken = () => b64url(crypto.randomBytes(32));

/**
 * Only same-site relative paths may be returned to after login (no open redirects):
 * must start with a single "/" and contain no backslashes or control characters.
 */
export function safeReturnTo(value) {
    const v = String(value || '');
    if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f]/.test(v)) {
        return '/';
    }
    return v.slice(0, 2048);
}

// ── Login ─────────────────────────────────────────────────────────────────

/**
 * Start a login: returns the Keycloak URL to redirect to, and the transaction
 * (state, nonce, PKCE verifier, return path) to keep in a signed, short-lived cookie.
 */
export async function beginLogin({
    returnTo = '/', forceReauth = false, popup = false, procedure = null,
    action = null, expectSub = null,
} = {}) {
    const meta = await getProviderMetadata();
    const { clientId } = kc();
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri(),
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // Ask for the password again even if a Keycloak sign-in is still alive
        // (starting procedure mode). Checked at the callback via auth_time.
        ...(forceReauth ? { max_age: '0', prompt: 'login' } : {}),
        // Change password on Keycloak's own page (application-initiated action).
        // Keycloak asks for the current password first if the sign-in is over 5 minutes old.
        ...(action === 'password' ? { kc_action: 'UPDATE_PASSWORD' } : {}),
    }).toString();

    const txCookie = jwt.sign(
        {
            state, nonce, verifier, returnTo: safeReturnTo(returnTo),
            // popup: the callback answers with a small page that tells the opener and closes
            // (re-sign-in without leaving the page). procedure: start procedure mode.
            ...(popup ? { popup: true } : {}),
            ...(procedure ? { procedure } : {}),
            ...(forceReauth ? { forceReauth: true } : {}),
            ...(action === 'password' ? { action: 'password' } : {}),
            // The account that must sign in (procedure mode, password change): the
            // signed-in user, not whoever happens to be at the keyboard.
            ...(expectSub ? { expectSub: String(expectSub) } : {}),
        },
        config.jwt.secret,
        { expiresIn: TX_TTL_SECONDS, audience: TX_AUDIENCE, algorithm: 'HS256' }
    );
    return { url: url.toString(), txCookie, txCookieName: txCookieName(state), txMaxAgeMs: TX_TTL_SECONDS * 1000 };
}

class LoginError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

function readTx(txCookie) {
    if (!txCookie) throw new LoginError('login_expired', 'No login in progress');
    try {
        return jwt.verify(txCookie, config.jwt.secret, { audience: TX_AUDIENCE, algorithms: ['HS256'] });
    } catch {
        throw new LoginError('login_expired', 'Login transaction expired or invalid');
    }
}

/** Shared ID/logout token checks: Keycloak's signature, our issuer, our client as audience. */
async function verifyKeycloakJwt(token, options = {}) {
    const meta = await getProviderMetadata();
    const { clientId } = kc();
    const { payload } = await jwtVerify(token, jwksFor(meta.jwks_uri), {
        issuer: meta.issuer,
        audience: clientId,
        algorithms: ['RS256', 'PS256', 'ES256'],
        clockTolerance: 30,
        ...options,
    });
    return payload;
}

/**
 * Finish a login from the callback query (?code&state or ?error) and the tx cookie.
 * Returns { user, kcSid, idToken, returnTo }; throws LoginError with a short code.
 */
export async function completeLogin({ query, txCookie }) {
    const tx = readTx(txCookie);
    const state = String(query?.state || '');
    const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
    if (!state || !crypto.timingSafeEqual(digest(state), digest(tx.state))) {
        throw new LoginError('login_state_mismatch', 'Login state did not match');
    }
    if (query?.error) {
        throw new LoginError('login_denied', String(query.error_description || query.error).slice(0, 200));
    }
    // Password change: Keycloak reports success, cancelled or error. Anything but
    // success leaves the current session as it is.
    if (tx.action === 'password' && query?.kc_action_status !== 'success') {
        throw new LoginError(
            query?.kc_action_status === 'cancelled' ? 'login_action_cancelled' : 'login_action_failed',
            `Password change ${String(query?.kc_action_status || 'not completed').slice(0, 40)}`
        );
    }
    const code = String(query?.code || '');
    if (!code) throw new LoginError('login_failed', 'No authorization code');

    const meta = await getProviderMetadata();
    const { clientId, clientSecret } = kc();
    const res = await fetch(meta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri(),
            code_verifier: tx.verifier,
            client_id: clientId,
            client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new LoginError('login_failed', `Code exchange failed (${res.status} ${body?.error || ''})`.trim());
    }
    const tokens = await res.json();
    if (!tokens?.id_token) throw new LoginError('login_failed', 'No ID token returned');

    let claims;
    try {
        claims = await verifyKeycloakJwt(tokens.id_token);
    } catch (err) {
        throw new LoginError('login_failed', `ID token rejected: ${err.code || err.message}`);
    }
    if (claims.nonce !== tx.nonce) throw new LoginError('login_failed', 'ID token nonce mismatch');
    // A fresh sign-in was asked for: Keycloak must have checked the password during this
    // login, not reused an earlier sign-in (auth_time is required when max_age is sent).
    if (tx.forceReauth) {
        const authTime = Number(claims.auth_time);
        if (!Number.isFinite(authTime) || authTime < Number(tx.iat) - AUTH_TIME_SKEW_SECONDS) {
            throw new LoginError('login_not_fresh', 'Keycloak did not ask for the password again');
        }
    }
    if (tx.expectSub && String(claims.sub) !== tx.expectSub) {
        throw new LoginError('login_wrong_account', 'A different account signed in');
    }

    return {
        user: resolveLocalUser(claims),
        kcSid: claims.sid ? String(claims.sid) : null,
        idToken: tokens.id_token,
        returnTo: safeReturnTo(tx.returnTo),
        popup: tx.popup === true,
        procedure: tx.procedure || null,
        action: tx.action || null,
    };
}

// ── Logout ────────────────────────────────────────────────────────────────

/**
 * Keycloak end-session URL that also ends the Keycloak sign-in, or null if Keycloak has
 * none. With the ID token Keycloak signs out straight away; without it (the app session
 * had already ended) Keycloak asks "Sign out?" first. Either way the Keycloak sign-in
 * ends, so the next sign-in on a shared workstation asks for a password.
 */
export async function buildLogoutUrl(idToken = null) {
    const meta = await getProviderMetadata();
    if (!meta.end_session_endpoint) return null;
    const url = new URL(meta.end_session_endpoint);
    url.search = new URLSearchParams({
        ...(idToken ? { id_token_hint: idToken } : {}),
        post_logout_redirect_uri: `${config.publicAppUrl}/`,
        client_id: kc().clientId,
    }).toString();
    return url.toString();
}

/**
 * Validate a back-channel logout token from Keycloak (OpenID Connect Back-Channel
 * Logout 1.0, section 2.6). Returns { sid, sub }; throws if invalid.
 */
export async function verifyLogoutToken(token) {
    const claims = await verifyKeycloakJwt(String(token || ''), { maxTokenAge: '5m' });
    if (!claims.events || typeof claims.events[BACKCHANNEL_LOGOUT_EVENT] !== 'object') {
        throw new Error('not a back-channel logout token');
    }
    if (claims.nonce !== undefined) throw new Error('logout token must not contain a nonce');
    if (!claims.sid && !claims.sub) throw new Error('logout token has neither sid nor sub');
    return { sid: claims.sid ? String(claims.sid) : null, sub: claims.sub ? String(claims.sub) : null };
}
