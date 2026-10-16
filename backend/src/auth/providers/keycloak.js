/**
 * Keycloak password login via BFF (Resource Owner Password Credentials flow).
 *
 * The user submits email + password to our login form. The backend exchanges
 * them for a Keycloak access token — no browser redirect to Keycloak.
 *
 * Role from Keycloak JWT claims is synced to the local user record at login
 * time so downstream middleware can read req.user.role without an extra
 * network call on every request.
 */

import User from '../../models/User.js';
import { AppError } from '../../utils/errors.js';
import { findLink, linkIdentity } from '../identityStore.js';
import { msg } from '../../i18n/index.js';

const PROVIDER = 'keycloak';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function keycloakConfig() {
    const url    = (process.env.KEYCLOAK_URL    || '').trim().replace(/\/+$/, '');
    const realm  = (process.env.KEYCLOAK_REALM  || 'slicer-web').trim();
    const clientId     = (process.env.KEYCLOAK_CLIENT_ID     || 'slicer-web-backend').trim();
    const clientSecret = (process.env.KEYCLOAK_CLIENT_SECRET || '').trim();

    if (!url) {
        throw new AppError(
            'Keycloak is not configured (KEYCLOAK_URL missing)',
            503,
            null,
            'keycloak.not_configured'
        );
    }

    return { url, realm, clientId, clientSecret };
}

function tokenEndpoint({ url, realm }) {
    return `${url}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

// ---------------------------------------------------------------------------
// JWT helpers (no signature verification — token came directly from Keycloak)
// ---------------------------------------------------------------------------

function decodeJwtPayload(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

// Map Keycloak realm role names to local role values.
// Priority: most-privileged role wins.
function pickRole(roles) {
    if (!Array.isArray(roles)) return 'user';
    if (roles.includes('app-admin'))     return 'admin';
    if (roles.includes('app-org-admin')) return 'org-admin';
    return 'user';
}

// ---------------------------------------------------------------------------
// Local user resolution
// ---------------------------------------------------------------------------

async function resolveLocalUser(claims) {
    const externalId = String(claims?.sub || '').trim();
    if (!externalId) {
        throw new AppError('Keycloak token missing sub claim', 502);
    }

    const email = String(claims?.email || '').trim().toLowerCase();
    if (!email) {
        throw new AppError('Keycloak token missing email claim', 502);
    }

    const role     = pickRole(claims?.roles);
    const username = buildUsername(claims, email);

    // First/last name live in Keycloak, not SQLite. Merge into the returned user object
    // so the app session JWT carries them without any DB write.
    const firstName = String(claims?.given_name  || '').trim() || null;
    const lastName  = String(claims?.family_name || '').trim() || null;
    const withName  = u => (u ? { ...u, firstName, lastName } : u);

    // Fast path: known link exists
    const existingLink = findLink(PROVIDER, externalId);
    if (existingLink) {
        const user = User.findById(existingLink.user_id);
        if (!user) {
            throw new AppError(msg('auth.account_link_broken'), 502, 'ACCOUNT_LINK_BROKEN');
        }
        if (user.is_active === 0 || user.is_active === false) return null;
        User.syncRole(user.id, role);
        User.touchLastLogin(user.id);
        return withName(User.findById(user.id));
    }

    // Email match: link an existing product user to this Keycloak identity
    const emailOwner = User.findByEmail(email);
    if (emailOwner) {
        linkIdentity(emailOwner.id, PROVIDER, externalId);
        User.syncRole(emailOwner.id, role);
        User.touchLastLogin(emailOwner.id);
        return withName(User.findById(emailOwner.id));
    }

    // New identity: create a shadow user
    const user = await User.createExternalShadow({ email, username });
    linkIdentity(user.id, PROVIDER, externalId);
    User.syncRole(user.id, role);
    return withName(User.findById(user.id));
}

function buildUsername(claims, email) {
    const preferred = String(claims?.preferred_username || '').trim();
    if (preferred && !preferred.includes('@')) return preferred.slice(0, 40);
    return email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'user';
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const keycloakProvider = {
    name: PROVIDER,

    /**
     * @param {{ identity: string, password: string }} credentials
     * @returns {Promise<{ user: object, externalTokens: null } | null>}
     */
    async login({ identity, password }) {
        const cfg = keycloakConfig();

        const res = await fetch(tokenEndpoint(cfg), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type:    'password',
                client_id:     cfg.clientId,
                client_secret: cfg.clientSecret,
                username:      String(identity || '').trim(),
                password:      String(password || ''),
                scope:         'openid profile email'
            })
        });

        // Bad credentials
        if (res.status === 401 || res.status === 400) {
            let body = null;
            try { body = await res.json(); } catch { /* non-JSON */ }

            if (body?.error === 'invalid_grant') return null;

            // Account disabled / locked
            if (body?.error_description?.toLowerCase().includes('disabled')) {
                return null;
            }

            throw new AppError(
                body?.error_description || 'Keycloak login failed',
                res.status >= 500 ? 502 : res.status
            );
        }

        if (!res.ok) {
            let body = null;
            try { body = await res.json(); } catch { /* non-JSON */ }
            throw new AppError(
                body?.error_description || `Keycloak error ${res.status}`,
                502
            );
        }

        const data = await res.json();
        const claims = decodeJwtPayload(data.access_token);
        if (!claims) {
            throw new AppError('Keycloak returned an unreadable access token', 502);
        }

        const user = await resolveLocalUser(claims);
        if (!user) return null;

        // We don't store Keycloak tokens: role is on the local user, and we
        // don't make call-as-user requests to Keycloak. Return null tokens.
        return { user, externalTokens: null };
    }
};
