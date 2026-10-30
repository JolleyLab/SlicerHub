/**
 * Keycloak Admin API helpers for case role management.
 *
 * Groups pattern: case:{caseId}:admin | case:{caseId}:collaborator | case:{caseId}:read_only
 * Groups are created lazily on first collaborator addition.
 */

import config from '../config/index.js';
import { findLinkForUser } from '../auth/identityStore.js';
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

    const update = { attributes };
    if (firstName !== undefined) update.firstName = String(firstName || '').trim();
    if (lastName  !== undefined) update.lastName  = String(lastName  || '').trim();

    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}`, update);
}

/**
 * Look up the Keycloak subject (sub) for a SQLite user.
 * Returns the Keycloak user ID string or null.
 */
export function getKeycloakSubForUser(sqliteUserId) {
    const link = findLinkForUser(sqliteUserId, 'keycloak');
    return link?.external_id ?? null;
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

/**
 * Create a new Keycloak user. The account is disabled until they redeem their invite
 * and set a password. Returns { id, email, firstName, lastName }.
 * If the email already exists, returns the existing user.
 */
export async function createKeycloakUser({ email, firstName = '', lastName = '' }) {
    const token = await getAdminToken();
    const res = await fetch(`${adminBase()}/users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            firstName,
            lastName,
            username: email,
            enabled: false,
            emailVerified: false,
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
 * Set a user's password. Use temporary=false for a permanent password set during invite redeem.
 */
export async function setKeycloakUserPassword(keycloakUserId, password, { temporary = false } = {}) {
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}/reset-password`, {
        type: 'password',
        value: password,
        temporary,
    });
}

/**
 * Enable a Keycloak user and optionally update their profile fields.
 */
export async function enableKeycloakUser(keycloakUserId, { firstName, lastName } = {}) {
    const updates = { enabled: true, emailVerified: true };
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName  !== undefined) updates.lastName  = lastName;
    await keycloakPut(`/users/${encodeURIComponent(keycloakUserId)}`, updates);
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
