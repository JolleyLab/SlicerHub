/**
 * Keycloak Admin API helpers for case role management.
 *
 * Groups pattern: case:{caseId}:admin | case:{caseId}:collaborator | case:{caseId}:read_only
 * Groups are created lazily on first collaborator addition.
 */

import config from '../config/index.js';
import { AppError, NotFoundError } from '../utils/errors.js';

export const CASE_ROLES = ['admin', 'collaborator', 'read_only'];

// ---------------------------------------------------------------------------
// Admin token — cached until near expiry
// ---------------------------------------------------------------------------

let _cachedToken = null;
let _tokenExpiry = 0;

export async function getAdminToken() {
    if (_cachedToken && Date.now() < _tokenExpiry - 30_000) return _cachedToken;

    const { url, adminUser, adminPassword } = config.keycloak;
    if (!url) throw new AppError('Keycloak is not configured (KEYCLOAK_URL missing)', 503);

    const res = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'password',
            client_id:  'admin-cli',
            username:   adminUser,
            password:   adminPassword,
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak admin login failed (${res.status}): ${text}`, 502);
    }

    const data = await res.json();
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in ?? 60) * 1000;
    return _cachedToken;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function adminBase() {
    const { url, realm } = config.keycloak;
    return `${url}/admin/realms/${encodeURIComponent(realm)}`;
}

async function keycloakGet(path) {
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak GET ${path} failed (${res.status}): ${text}`, 502);
    }
    return res.json();
}

async function keycloakPost(path, body) {
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 201 && res.status !== 204) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak POST ${path} failed (${res.status}): ${text}`, 502);
    }
    // 201 Created has Location header; 200 may have body; 204 has none
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json') && res.status !== 204) {
        return res.json().catch(() => null);
    }
    return null;
}

async function keycloakPut(path, body) {
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}${path}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak PUT ${path} failed (${res.status}): ${text}`, 502);
    }
    return null;
}

async function keycloakDelete(path) {
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak DELETE ${path} failed (${res.status}): ${text}`, 502);
    }
    return null;
}

// ---------------------------------------------------------------------------
// User lookup
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display name from a KC user object (or any object with
 * { preferredName?, firstName?, lastName?, username?, email? }).
 * Priority: preferredName → full name → username → email → fallback.
 */
export function kcDisplayName(user, fallback = '') {
    if (!user) return fallback;
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return user.preferredName || full || user.username || user.email || fallback;
}

/**
 * Find a Keycloak user by exact email address.
 * Returns { id, email, firstName, lastName, username, preferredName, displayName } or null.
 */
export async function findUserByEmail(email) {
    const results = await keycloakGet(
        `/users?email=${encodeURIComponent(email)}&exact=true`
    );
    const user = results?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) return null;
    const shaped = {
        id:           user.id,
        email:        user.email,
        firstName:    user.firstName || '',
        lastName:     user.lastName  || '',
        username:     user.username  || '',
        preferredName: user.attributes?.preferredName?.[0] || '',
    };
    return { ...shaped, displayName: kcDisplayName(shaped) };
}

/**
 * Current account state for session re-validation: whether the user still exists,
 * whether it is enabled, and its effective realm roles (including roles inherited
 * through Keycloak groups and composites). Throws on Keycloak/network errors so
 * callers can tell "account gone" apart from "Keycloak unreachable".
 *
 * `notBefore` (seconds, 0 = none) is set by Keycloak's "log out user" admin action:
 * sessions started before it are no longer valid.
 *
 * @returns {Promise<{ exists: boolean, enabled: boolean, realmRoles: string[], notBefore: number }>}
 */
export async function getUserAccountState(keycloakUserId) {
    const token = await getAdminToken();
    const base = `${adminBase()}/users/${encodeURIComponent(keycloakUserId)}`;
    const headers = { Authorization: `Bearer ${token}` };

    const userRes = await fetch(base, { headers, signal: AbortSignal.timeout(5000) });
    if (userRes.status === 404) return { exists: false, enabled: false, realmRoles: [], notBefore: 0 };
    if (!userRes.ok) throw new AppError(`Keycloak GET user failed (${userRes.status})`, 502);
    const user = await userRes.json();

    const rolesRes = await fetch(`${base}/role-mappings/realm/composite`, { headers, signal: AbortSignal.timeout(5000) });
    if (!rolesRes.ok) throw new AppError(`Keycloak GET realm roles failed (${rolesRes.status})`, 502);
    const roles = await rolesRes.json();

    return {
        exists: true,
        enabled: user?.enabled !== false,
        realmRoles: (Array.isArray(roles) ? roles : []).map(r => r?.name).filter(Boolean),
        notBefore: Number(user?.notBefore) || 0,
    };
}

/**
 * Get a Keycloak user by their Keycloak ID.
 * Returns { id, email, firstName, lastName, username, preferredName, displayName } or null.
 */
export async function getKeycloakUser(keycloakUserId) {
    try {
        const user = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}`);
        if (!user) return null;
        const shaped = {
            id:            user.id,
            email:         user.email,
            firstName:     user.firstName || '',
            lastName:      user.lastName  || '',
            username:      user.username  || '',
            preferredName: user.attributes?.preferredName?.[0] || '',
        };
        return { ...shaped, displayName: kcDisplayName(shaped) };
    } catch {
        return null;
    }
}

/**
 * Update a Keycloak user's profile fields.
 * Merges attributes so other custom attributes are not wiped.
 */
export async function updateKeycloakUserProfile(keycloakUserId, { firstName, lastName, preferredName } = {}) {
    const current = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}`);
    const attributes = { ...(current?.attributes ?? {}) };

    if (preferredName !== undefined) {
        const trimmed = String(preferredName || '').trim();
        if (trimmed) {
            attributes.preferredName = [trimmed];
        } else {
            delete attributes.preferredName;
        }
    }

    // Keycloak's user profile (KC 24+) validates the whole representation on PUT: fields
    // left out read as cleared, and a missing email fails "error-user-attribute-required".
    // Send the current username/email/names back unchanged alongside the edit.
    const update = {
        username:  current?.username,
        email:     current?.email,
        firstName: current?.firstName,
        lastName:  current?.lastName,
        attributes,
    };
    if (firstName !== undefined) update.firstName = String(firstName || '').trim();
    if (lastName  !== undefined) update.lastName  = String(lastName  || '').trim();

    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}`, update);
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

/**
 * Create a new Keycloak user. Returns { id, email, firstName, lastName }.
 * If the email already exists, returns the existing user.
 *
 * Default (app's own invite flow): disabled until they redeem their invite and set a
 * password. With `requiredActions` (Keycloak flow): enabled but unable to sign in until
 * they complete the actions from Keycloak's account-setup email (sendExecuteActionsEmail).
 */
export async function createKeycloakUser({ email, firstName = '', lastName = '', requiredActions = null }) {
    const token = await getAdminToken();
    const keycloakFlow = Array.isArray(requiredActions) && requiredActions.length > 0;
    const res = await fetch(`${adminBase()}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            firstName,
            lastName,
            username: email,
            enabled: keycloakFlow,
            emailVerified: false,
            ...(keycloakFlow ? { requiredActions } : {}),
        }),
    });

    if (res.status === 409) {
        const existing = await findUserByEmail(email);
        if (existing) return existing;
        throw new AppError('User already exists but could not be retrieved', 409);
    }
    if (!res.ok && res.status !== 201) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Keycloak create user failed (${res.status}): ${text}`, 502);
    }

    // Keycloak returns Location: .../users/{id}
    const location = res.headers.get('location') || '';
    const id = location.split('/').pop();
    return { id, email, firstName, lastName, username: email };
}

/**
 * Ask Keycloak to email the user a link to complete `actions` (e.g. VERIFY_EMAIL,
 * UPDATE_PASSWORD), then return them to `redirectUri`. Uses the realm's SMTP and the
 * slicerhub email theme. Throws if Keycloak could not send it.
 */
export async function sendExecuteActionsEmail(keycloakUserId, actions, { redirectUri, lifespanSeconds } = {}) {
    const params = new URLSearchParams({ client_id: config.keycloak.clientId });
    if (redirectUri) params.set('redirect_uri', redirectUri);
    if (lifespanSeconds) params.set('lifespan', String(Math.floor(lifespanSeconds)));
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}/execute-actions-email?${params}`, actions);
}

/**
 * Make an existing account ready for Keycloak account setup, if it needs it.
 * - disabled (left so by the app's older invite flow): enable it and add `actions`;
 * - enabled with setup still pending: leave it;
 * - enabled and set up (an active account): leave it — never force a password reset.
 * Returns true when the account still needs setup (send the setup email), false when
 * it is already active.
 */
export async function prepareAccountSetup(keycloakUserId, actions) {
    const user = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}`);
    if (!user) return true;
    const pending = user.requiredActions || [];
    if (user.enabled) return actions.some((a) => pending.includes(a));
    const requiredActions = [...new Set([...pending, ...actions])];
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}`, { ...user, enabled: true, requiredActions });
    return true;
}

/**
 * Delete an invitee's account if it was never set up: password setup still pending and
 * no password stored. Used when an invite expires unused, so the account (with the
 * email and case role) doesn't linger. Returns true if deleted.
 */
export async function deleteAccountIfNeverSetUp(keycloakUserId) {
    const id = encodeURIComponent(keycloakUserId);
    const user = await keycloakGet(`/users/${id}`).catch((err) => {
        if (/\(404\)/.test(String(err?.message))) return null; // already gone
        throw err;
    });
    if (!user) return false;
    if (!(user.requiredActions || []).includes('UPDATE_PASSWORD')) return false;
    const credentials = await keycloakGet(`/users/${id}/credentials`);
    if ((Array.isArray(credentials) ? credentials : []).some((c) => c?.type === 'password')) return false;
    await keycloakDelete(`/users/${id}`);
    return true;
}

/** Registration details a person entered on Keycloak's sign-up page (user-profile attributes). */
export async function getRegistrationAttributes(keycloakUserId) {
    const user = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}`);
    const first = (name) => String(user?.attributes?.[name]?.[0] || '').trim();
    return { affiliation: first('affiliation'), intendedUse: first('intendedUse') };
}

/**
 * Remove registration-only attributes from the Keycloak account once a reviewer has
 * decided (privacy minimization: the review record keeps them, and is itself cleared
 * after 30 days by the retention sweep).
 */
export async function clearRegistrationAttributes(keycloakUserId) {
    const user = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}`);
    if (!user) return;
    const attributes = { ...(user.attributes || {}) };
    delete attributes.affiliation;
    delete attributes.intendedUse;
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}`, { ...user, attributes });
}

// ---------------------------------------------------------------------------
// Realm role management
// ---------------------------------------------------------------------------

/**
 * List all users assigned a given realm role.
 * Returns [{ id, email, firstName, lastName, username, preferredName, displayName }].
 */
export async function getUsersWithRealmRole(roleName) {
    try {
        const users = await keycloakGet(
            `/roles/${encodeURIComponent(roleName)}/users?max=500`
        );
        console.log(`[keycloakAdmin] getUsersWithRealmRole(${roleName}): ${Array.isArray(users) ? users.length : 0} user(s)`);
        return (Array.isArray(users) ? users : []).map(u => {
            const shaped = {
                id:            u.id,
                email:         u.email        || '',
                firstName:     u.firstName    || '',
                lastName:      u.lastName     || '',
                username:      u.username     || '',
                preferredName: u.attributes?.preferredName?.[0] || '',
            };
            return { ...shaped, displayName: kcDisplayName(shaped) };
        });
    } catch (err) {
        console.warn(`[keycloakAdmin] getUsersWithRealmRole(${roleName}) failed:`, err?.message);
        return [];
    }
}

/**
 * Assign a realm-level role to a Keycloak user by role name (e.g. 'app-org-admin').
 * No-ops if the role does not exist (misconfigured realm) rather than throwing,
 * so account creation still succeeds.
 */
export async function assignRealmRole(keycloakUserId, roleName) {
    let role;
    try {
        role = await keycloakGet(`/roles/${encodeURIComponent(roleName)}`);
    } catch {
        console.warn(`[keycloakAdmin] Realm role '${roleName}' not found — skipping assignment`);
        return;
    }
    await keycloakPost(`/users/${encodeURIComponent(keycloakUserId)}/role-mappings/realm`, [
        { id: role.id, name: role.name }
    ]);
}

/** Realm attributes (string map) from the realm representation. */
export async function getRealmAttributes() {
    const realm = await keycloakGet('');
    return realm?.attributes || {};
}

/** Set realm attributes, keeping the ones not mentioned. */
export async function setRealmAttributes(patch) {
    const current = await getRealmAttributes();
    await keycloakPut('', { attributes: { ...current, ...patch } });
}

/** Every user id in the realm (paged), excluding service-account users. */
export async function listAllUserIds({ pageSize = 100 } = {}) {
    const ids = [];
    for (let first = 0; ; first += pageSize) {
        const page = await keycloakGet(`/users?first=${first}&max=${pageSize}&briefRepresentation=true`);
        if (!Array.isArray(page) || page.length === 0) break;
        for (const u of page) {
            if (u?.id && !String(u.username || '').startsWith('service-account-')) ids.push(u.id);
        }
        if (page.length < pageSize) break;
    }
    return ids;
}

/** Ids of users who hold a realm role directly. */
export async function listRealmRoleMemberIds(roleName, { pageSize = 100 } = {}) {
    const ids = new Set();
    for (let first = 0; ; first += pageSize) {
        const page = await keycloakGet(`/roles/${encodeURIComponent(roleName)}/users?first=${first}&max=${pageSize}&briefRepresentation=true`);
        if (!Array.isArray(page) || page.length === 0) break;
        for (const u of page) if (u?.id) ids.add(u.id);
        if (page.length < pageSize) break;
    }
    return ids;
}

/** Permanently delete a Keycloak user (used when a reviewer rejects an account). */
export async function deleteKeycloakUser(keycloakUserId) {
    await keycloakDelete(`/users/${encodeURIComponent(keycloakUserId)}`);
}

// ---------------------------------------------------------------------------
// Group management
// ---------------------------------------------------------------------------

function groupName(caseId, role) {
    return `case:${caseId}:${role}`;
}

/**
 * Find an existing Keycloak group by exact name.
 * Returns { id, name } or null.
 */
export async function findCaseGroup(caseId, role) {
    const name = groupName(caseId, role);
    const results = await keycloakGet(
        `/groups?search=${encodeURIComponent(name)}&exact=true`
    );
    // search may return partial matches — filter for exact name at top level
    const group = results?.find(g => g.name === name);
    return group ? { id: group.id, name: group.name } : null;
}

/**
 * Get (or create) the Keycloak group for a case + role.
 * Returns the group ID.
 */
export async function ensureCaseGroup(caseId, role) {
    const existing = await findCaseGroup(caseId, role);
    if (existing) return existing.id;

    // Create the group
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}/groups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName(caseId, role) }),
    });

    if (res.status === 409) {
        // Race — created concurrently; fetch and return
        const found = await findCaseGroup(caseId, role);
        if (found) return found.id;
    }

    if (!res.ok && res.status !== 201) {
        const text = await res.text().catch(() => '');
        throw new AppError(`Failed to create Keycloak group (${res.status}): ${text}`, 502);
    }

    // Keycloak returns 201 with Location: .../groups/{id}
    const location = res.headers.get('location') || '';
    const idFromLocation = location.split('/').pop();
    if (idFromLocation && idFromLocation.length > 8) return idFromLocation;

    // Fallback: search again
    const created = await findCaseGroup(caseId, role);
    if (!created) throw new AppError(`Group created but not found: ${groupName(caseId, role)}`, 500);
    return created.id;
}

/**
 * Add a Keycloak user to a case role group.
 * Removes them from all other role groups for this case first (one role per case).
 */
export async function addUserToCaseGroup(keycloakUserId, caseId, role) {
    // Remove from any existing role groups for this case
    await removeUserFromAllCaseGroups(keycloakUserId, caseId);
    const groupId = await ensureCaseGroup(caseId, role);
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}/groups/${encodeURIComponent(groupId)}`, {});
}

/**
 * Remove a Keycloak user from all role groups for a given case.
 */
export async function removeUserFromAllCaseGroups(keycloakUserId, caseId) {
    for (const role of CASE_ROLES) {
        const group = await findCaseGroup(caseId, role);
        if (!group) continue;
        try {
            await keycloakDelete(`/users/${encodeURIComponent(keycloakUserId)}/groups/${encodeURIComponent(group.id)}`);
        } catch {
            // Ignore 404 — user was not in the group
        }
    }
}

/**
 * Get the case role for a Keycloak user (by checking their group membership).
 * Returns 'admin' | 'collaborator' | 'read_only' | null.
 */
export async function getUserCaseRole(keycloakUserId, caseId) {
    const groups = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}/groups`);
    const prefix = `case:${caseId}:`;
    for (const g of groups ?? []) {
        if (g.name?.startsWith(prefix)) {
            const role = g.name.slice(prefix.length);
            if (CASE_ROLES.includes(role)) return role;
        }
    }
    return null;
}

/**
 * Get all case roles for a Keycloak user.
 * Returns { [caseId]: role } map derived from all case:* groups the user belongs to.
 */
export async function getUserCaseRoleMap(keycloakUserId) {
    const groups = await keycloakGet(`/users/${encodeURIComponent(keycloakUserId)}/groups`);
    const map = {};
    for (const g of groups ?? []) {
        const m = g.name?.match(/^case:(\d+):(\w+)$/);
        if (m && CASE_ROLES.includes(m[2])) {
            map[m[1]] = m[2];
        }
    }
    return map;
}

/**
 * List all collaborators on a case (from all three role groups).
 * Returns [{ id, email, firstName, lastName, preferredName, displayName, role }].
 */
export async function listCaseCollaborators(caseId) {
    const results = [];
    for (const role of CASE_ROLES) {
        const group = await findCaseGroup(caseId, role);
        if (!group) continue;
        // briefRepresentation=false fetches full user objects including attributes
        const members = await keycloakGet(
            `/groups/${encodeURIComponent(group.id)}/members?briefRepresentation=false`
        );
        for (const m of members ?? []) {
            const shaped = {
                id:           m.id,
                email:        m.email     || '',
                firstName:    m.firstName || '',
                lastName:     m.lastName  || '',
                username:     m.username  || '',
                preferredName: m.attributes?.preferredName?.[0] || '',
            };
            results.push({
                ...shaped,
                displayName: kcDisplayName(shaped),
                avatarUrl:   `/api/users/${encodeURIComponent(m.id)}/avatar`,
                role,
            });
        }
    }
    return results;
}
