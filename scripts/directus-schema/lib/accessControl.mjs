/**
 * Export / apply helpers for Directus "access control" (roles, policies, permissions,
 * the policy↔role/public attachment junction). This is NOT part of /schema/snapshot —
 * Directus treats it as system collection data, not data model schema — so it needs its
 * own fetch + idempotent-create logic, separate from the official schema diff/apply flow.
 *
 * Scope: role-level and public policy attachments only. User-linked directus_access rows
 * (a policy attached to one specific person) are never exported — a user id from the
 * source instance has no meaning on a different target instance.
 */

async function fetchAll(client, collection, fields = '*') {
    const rows = await client.get(`/${collection}?limit=-1&fields=${encodeURIComponent(fields)}`);
    return Array.isArray(rows) ? rows : [];
}

// `fields=*` on roles/policies pulls in reverse o2m aliases too (role.policies, role.users,
// role.children; policy.permissions, policy.users, policy.roles) — these are NOT real columns.
// Directus's create/update endpoints treat an o2m/m2m field in the body as a nested relational
// write, so posting one of these back verbatim could reassign real users' roles on the target,
// or try to link to policy/role ids that don't exist there yet. Only request real columns.
const ROLE_FIELDS = 'id,name,icon,description,parent';
const POLICY_FIELDS = 'id,name,icon,description,ip_access,enforce_tfa,admin_access,app_access';

/** Strip anything that isn't one of a role/policy's own real columns, just in case an older
 * export (or a future Directus version) still carries alias fields through to here. Never
 * includes `id` — the source id is only a join key within the export file itself (how a
 * permission/access row says which policy/role it belongs to); the target gets its own
 * Directus-assigned id, same as every other collection. */
function pickRoleFields(role) {
    const { name, icon, description, parent } = role || {};
    return { name, icon, description, parent };
}
function pickPolicyFields(policy) {
    const { name, icon, description, ip_access, enforce_tfa, admin_access, app_access } = policy || {};
    return { name, icon, description, ip_access, enforce_tfa, admin_access, app_access };
}

/** Pull roles, policies, permissions, and role/public access rows from one Directus instance. */
export async function exportAccessControl(client) {
    const [roles, policies, permissions, accessRaw] = await Promise.all([
        fetchAll(client, 'roles', ROLE_FIELDS),
        fetchAll(client, 'policies', POLICY_FIELDS),
        fetchAll(client, 'permissions'),
        fetchAll(client, 'access')
    ]);

    // Keep role-linked rows (role set, user null) and public/global rows (both null).
    // Drop anything tied to a specific user — meaningless on a different instance.
    const access = accessRaw.filter((row) => !row.user);

    return { roles, policies, permissions, access };
}

/**
 * Idempotently replay an access-control export onto a target instance.
 * Never edits or deletes anything that already exists — only creates what's missing,
 * matched by name (roles, policies) or by content tuple (permissions, access rows).
 */
export async function applyAccessControl(client, exported, { dryRun }) {
    const report = { roles: [], policies: [], permissions: [], access: [] };
    const roleIdMap = new Map(); // source role id -> target role id
    const policyIdMap = new Map(); // source policy id -> target policy id

    // --- Roles ---
    const existingRoles = await fetchAll(client, 'roles', ROLE_FIELDS);
    const existingRoleByName = new Map(
        existingRoles.map((r) => [String(r.name || '').trim().toLowerCase(), r])
    );
    for (const role of exported.roles || []) {
        const key = String(role.name || '').trim().toLowerCase();
        const existing = existingRoleByName.get(key);
        if (existing) {
            roleIdMap.set(role.id, existing.id);
            report.roles.push(`skip (already exists): ${role.name}`);
            continue;
        }
        report.roles.push(`create: ${role.name}`);
        if (!dryRun) {
            try {
                const created = await client.post('/roles', pickRoleFields(role));
                roleIdMap.set(role.id, created.id);
            } catch (err) {
                report.roles.push(`  ! failed to create "${role.name}": ${err.message}`);
            }
        } else {
            // No real id exists yet in dry-run — fine, nothing downstream actually writes.
            roleIdMap.set(role.id, role.id);
        }
    }

    // --- Policies ---
    const existingPolicies = await fetchAll(client, 'policies', POLICY_FIELDS);
    const existingPolicyByName = new Map(
        existingPolicies.map((p) => [String(p.name || '').trim().toLowerCase(), p])
    );
    for (const policy of exported.policies || []) {
        const key = String(policy.name || '').trim().toLowerCase();
        const existing = existingPolicyByName.get(key);
        if (existing) {
            policyIdMap.set(policy.id, existing.id);
            report.policies.push(`skip (already exists): ${policy.name}`);
            continue;
        }
        report.policies.push(`create: ${policy.name}`);
        if (!dryRun) {
            try {
                const created = await client.post('/policies', pickPolicyFields(policy));
                policyIdMap.set(policy.id, created.id);
            } catch (err) {
                report.policies.push(`  ! failed to create "${policy.name}": ${err.message}`);
            }
        } else {
            // No real id exists yet in dry-run — fine, nothing downstream actually writes.
            policyIdMap.set(policy.id, policy.id);
        }
    }

    // --- Permissions (dedupe by policy + collection + action) ---
    // Only create/failure lines are printed individually — "already exists" and "no owning
    // policy" are expected in bulk (many policies legitimately share a collection+action, and
    // Directus has its own built-in baseline permissions with no policy row at all) and were
    // drowning out anything actually worth looking at. Counts are summarized instead.
    const existingPermissions = await fetchAll(client, 'permissions');
    const permKey = (p) => `${p.policy}::${p.collection}::${p.action}`;
    const existingPermKeys = new Set(existingPermissions.map(permKey));
    let permBuiltin = 0; // perm.policy is null — Directus's own implicit baseline, nothing to replicate
    let permAlreadyExists = 0;
    let permUnresolvedPolicy = 0; // perm.policy pointed at a real source id, but it never resolved — worth a look
    let permPlanRestricted = 0; // target's Directus plan doesn't support custom permission rules
    for (const perm of exported.permissions || []) {
        if (perm.policy == null) {
            permBuiltin += 1;
            continue;
        }
        const targetPolicyId = policyIdMap.get(perm.policy);
        if (!targetPolicyId) {
            permUnresolvedPolicy += 1;
            continue;
        }
        const candidate = { ...perm, policy: targetPolicyId };
        delete candidate.id; // permission ids are not referenced elsewhere — let Directus assign
        const key = permKey(candidate);
        if (existingPermKeys.has(key)) {
            permAlreadyExists += 1;
            continue;
        }
        report.permissions.push(`create: ${perm.collection}.${perm.action}`);
        if (!dryRun) {
            try {
                await client.post('/permissions', candidate);
                existingPermKeys.add(key);
            } catch (err) {
                if (/custom_permission_rules_enabled/i.test(err.message || '')) {
                    permPlanRestricted += 1;
                } else {
                    report.permissions.push(`  ! failed to create "${perm.collection}.${perm.action}": ${err.message}`);
                }
            }
        }
    }
    if (permAlreadyExists > 0 || permBuiltin > 0) {
        report.permissions.push(
            `${permAlreadyExists} already present, ${permBuiltin} built-in (no owning policy — nothing to replicate)`
        );
    }
    if (permPlanRestricted > 0) {
        report.permissions.push(
            `  ⚠ ${permPlanRestricted} permission(s) rejected — this target's Directus plan doesn't support `
            + 'custom field-level permission rules ("custom_permission_rules_enabled"). The source instance this '
            + 'was generated from has that enabled (an innovation/grant-tier Directus Cloud plan); most of this '
            + "app's permission model depends on it. This is a KNOWN LIMITATION of running this setup on a plan "
            + 'without that feature, not a bug in this script, and not something to silently work around — flag '
            + 'it to whoever owns this target instance before assuming the app will work correctly there. '
            + 'See scripts/directus-schema/README.md.'
        );
    }
    if (permUnresolvedPolicy > 0) {
        report.permissions.push(
            `  ! ${permUnresolvedPolicy} skipped — referenced a policy id this export doesn't have (unexpected; worth a look)`
        );
    }

    // --- Access (role/public attachments only; dedupe by role + policy) ---
    const existingAccess = (await fetchAll(client, 'access')).filter((row) => !row.user);
    const accessKey = (row) => `${row.role || 'public'}::${row.policy}`;
    const existingAccessKeys = new Set(existingAccess.map(accessKey));
    for (const row of exported.access || []) {
        const targetPolicyId = policyIdMap.get(row.policy);
        if (!targetPolicyId) {
            report.access.push(`  ! skipped (no resolved policy for source id ${row.policy})`);
            continue;
        }
        const targetRoleId = row.role ? roleIdMap.get(row.role) : null;
        if (row.role && !targetRoleId) {
            report.access.push(`  ! skipped (no resolved role for source id ${row.role})`);
            continue;
        }
        const candidate = { role: targetRoleId || null, user: null, policy: targetPolicyId, sort: row.sort ?? null };
        const key = accessKey(candidate);
        if (existingAccessKeys.has(key)) {
            report.access.push(`skip (already exists): role=${targetRoleId || 'public'} policy=${targetPolicyId}`);
            continue;
        }
        report.access.push(`create: role=${targetRoleId || 'public'} policy=${targetPolicyId}`);
        if (!dryRun) {
            try {
                await client.post('/access', candidate);
                existingAccessKeys.add(key);
            } catch (err) {
                report.access.push(`  ! failed to create access row: ${err.message}`);
            }
        }
    }

    return report;
}
