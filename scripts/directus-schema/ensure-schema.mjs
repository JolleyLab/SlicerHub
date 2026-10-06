/**
 * Idempotent Directus schema ensure (collections / fields / relations).
 *
 * Security model:
 * - CLI only. Never expose as a product HTTP route.
 * - Auth is on-demand: interactive Directus Administrator login, or a
 *   one-run pasted token. Do not store admin tokens in .env.
 * - Do NOT give hospital case-admins Directus Administrator.
 * - Day-to-day DIRECTUS_TOKEN stays for system ops — not schema.
 *
 * Usage:
 *   node scripts/directus-schema/ensure-schema.mjs --dry-run
 *   node scripts/directus-schema/ensure-schema.mjs
 *   node scripts/directus-schema/ensure-schema.mjs --paste-token
 *   node scripts/directus-schema/ensure-schema.mjs --only=case_invites
 */

import { loadRepoEnv } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { loginDirectusAdmin, logoutDirectus, prompt } from './lib/login.mjs';
import { caseInvitesDefinition } from './definitions/case-invites.mjs';
import { attachmentAccountabilityDefinition } from './definitions/attachment-accountability.mjs';
import { taskGroupsDefinition, taskGroupMembersDefinition } from './definitions/task-groups.mjs';

loadRepoEnv();

// task_groups must come before task_group_members (FK dependency)
const DEFINITIONS = Object.freeze([
    caseInvitesDefinition,
    attachmentAccountabilityDefinition,
    taskGroupsDefinition,
    taskGroupMembersDefinition
]);

// Name of the pre-configured group that can approve invitations.
const INVITE_APPROVERS_GROUP_NAME = 'Invite Approvers';

// Role names (case-insensitive) whose members are seeded into that group.
const ADMIN_ROLE_NAMES = ['administrator', 'orgadmin'];

function parseArgs(argv) {
    const flags = new Set();
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--only=')) {
            opts.only = arg.slice('--only='.length).trim();
        } else if (arg.startsWith('--')) {
            flags.add(arg.slice(2));
        }
    }
    return {
        dryRun: flags.has('dry-run'),
        seed: flags.has('seed'),
        pasteToken: flags.has('paste-token'),
        login: flags.has('login') || (!flags.has('paste-token') && !flags.has('allow-service-token')),
        allowServiceToken: flags.has('allow-service-token'),
        help: flags.has('help') || flags.has('h'),
        only: opts.only || null
    };
}

async function resolveAuth(url, args) {
    if (args.pasteToken) {
        const token = await prompt(
            'Paste a one-run Directus admin access or static token (not saved): '
        );
        if (!token) throw new Error('No token pasted');
        return { token, source: 'pasted (one-run)', refreshToken: null };
    }

    if (args.allowServiceToken) {
        const service = (process.env.DIRECTUS_TOKEN || '').trim();
        if (!service) {
            throw new Error('DIRECTUS_TOKEN is empty; cannot use --allow-service-token');
        }
        console.warn(
            'Warning: using DIRECTUS_TOKEN for schema. Prefer --login or --paste-token.'
        );
        return { token: service, source: 'DIRECTUS_TOKEN (--allow-service-token)', refreshToken: null };
    }

    // Default: interactive Directus Administrator login (short-lived session).
    console.log('Sign in to Directus as an Administrator (session used only for this run).');
    const session = await loginDirectusAdmin(url);
    return {
        token: session.accessToken,
        source: 'interactive login (ephemeral)',
        refreshToken: session.refreshToken
    };
}

async function collectionExists(client, name) {
    try {
        await client.get(`/collections/${encodeURIComponent(name)}`);
        return true;
    } catch (err) {
        if (err.status === 403 || err.status === 404) return false;
        throw err;
    }
}

async function listFieldNames(client, collection) {
    const data = await client.get(`/fields/${encodeURIComponent(collection)}`);
    const rows = Array.isArray(data) ? data : [];
    return new Set(rows.map((f) => f.field));
}

async function listRelationKeys(client, collection) {
    const data = await client.get(
        `/relations?filter[collection][_eq]=${encodeURIComponent(collection)}`
    );
    const rows = Array.isArray(data) ? data : [];
    return new Set(rows.map((r) => `${r.collection}.${r.field}`));
}

async function ensureDefinition(client, def, { dryRun }) {
    const name = def.collection;
    const exists = await collectionExists(client, name);
    const plan = [];

    if (!exists) {
        plan.push(`create collection ${name}`);
        if (!dryRun) {
            await client.post('/collections', {
                collection: name,
                meta: def.meta,
                schema: def.schema,
                fields: def.fields
            });
        }
    } else {
        const existingFields = await listFieldNames(client, name);
        for (const field of def.fields) {
            if (existingFields.has(field.field)) continue;
            plan.push(`create field ${name}.${field.field}`);
            if (!dryRun) {
                await client.post(`/fields/${encodeURIComponent(name)}`, field);
            }
        }
    }

    const afterCreate = !exists && dryRun;
    if (!afterCreate) {
        const existingRel = exists
            ? await listRelationKeys(client, name)
            : new Set();
        for (const rel of def.relations || []) {
            const key = `${rel.collection}.${rel.field}`;
            if (existingRel.has(key)) continue;
            if (!exists && !dryRun) {
                const refreshed = await listRelationKeys(client, name);
                if (refreshed.has(key)) continue;
            }
            plan.push(`create relation ${key} → ${rel.related_collection}`);
            if (!dryRun) {
                try {
                    await client.post('/relations', rel);
                } catch (err) {
                    const msg = String(err.message || '');
                    if (/already exists|duplicate|unique/i.test(msg) || err.status === 400) {
                        plan.push(`  (skipped relation ${key}: ${msg})`);
                        continue;
                    }
                    throw err;
                }
            }
        }
    } else {
        for (const rel of def.relations || []) {
            plan.push(`create relation ${rel.collection}.${rel.field} → ${rel.related_collection}`);
        }
    }

    if (plan.length === 0) {
        plan.push(`ok — ${name} already matches definition`);
    }
    return plan;
}

/**
 * Ensure the "Invite Approvers" special group exists and contains all current
 * Administrator / OrgAdmin users. Idempotent — safe to re-run.
 */
async function seedInviteApprovers(client, { dryRun }) {
    console.log(`▸ seed: ${INVITE_APPROVERS_GROUP_NAME}`);
    const plan = [];

    // 1. Find or create the group
    let groupId;
    const existing = await client.get(
        `/items/task_groups?filter[name][_eq]=${encodeURIComponent(INVITE_APPROVERS_GROUP_NAME)}&fields=id&limit=1`
    );
    const existingRows = Array.isArray(existing) ? existing : [];
    if (existingRows.length > 0) {
        groupId = existingRows[0].id;
        plan.push(`group already exists (id: ${groupId})`);
        // Ensure can_approve_registrations is true
        if (!dryRun) {
            await client.patch(`/items/task_groups/${encodeURIComponent(groupId)}`, {
                can_approve_registrations: true
            });
        }
    } else {
        plan.push(`create group "${INVITE_APPROVERS_GROUP_NAME}" with can_approve_registrations=true`);
        if (!dryRun) {
            const created = await client.post('/items/task_groups', {
                name: INVITE_APPROVERS_GROUP_NAME,
                description: 'Members of this group can approve new user registration requests.',
                can_approve_registrations: true
            });
            groupId = created?.id;
        }
    }

    if (dryRun) {
        plan.push('(dry-run: skipping user sync)');
        for (const line of plan) console.log(`  - ${line}`);
        console.log('');
        return;
    }

    // 2. Find roles matching admin names
    const roles = await client.get('/roles?fields=id,name&limit=-1');
    const roleRows = Array.isArray(roles) ? roles : [];
    const adminRoleIds = roleRows
        .filter(r => ADMIN_ROLE_NAMES.includes(String(r.name || '').toLowerCase()))
        .map(r => r.id);

    if (adminRoleIds.length === 0) {
        plan.push('no Administrator/OrgAdmin roles found — skipping user sync');
        for (const line of plan) console.log(`  - ${line}`);
        console.log('');
        return;
    }

    // 3. Fetch all users with those roles
    const usersFilter = adminRoleIds
        .map(id => `filter[role][_in]=${encodeURIComponent(id)}`)
        .join('&');
    const users = await client.get(`/users?${usersFilter}&fields=id,email,first_name&limit=-1`);
    const userRows = Array.isArray(users) ? users : [];

    // 4. Fetch existing members to avoid duplicates
    const membersRes = await client.get(
        `/items/task_group_members?filter[task_group][_eq]=${encodeURIComponent(groupId)}&fields=directus_user&limit=-1`
    );
    const memberRows = Array.isArray(membersRes) ? membersRes : [];
    const existingMemberIds = new Set(memberRows.map(m =>
        typeof m.directus_user === 'object' ? m.directus_user?.id : m.directus_user
    ).filter(Boolean));

    // 5. Add missing users
    let added = 0;
    for (const user of userRows) {
        if (existingMemberIds.has(user.id)) continue;
        await client.post('/items/task_group_members', {
            task_group: groupId,
            directus_user: user.id,
            can_manage_group: false
        });
        plan.push(`added ${user.email || user.id}`);
        added++;
    }

    if (added === 0) plan.push('all admin users already members — nothing to add');
    for (const line of plan) console.log(`  - ${line}`);
    console.log('');
}

function printHelp() {
    console.log(`Directus schema ensure (dev / site bootstrap)

Requires:
  DIRECTUS_URL   (from .env is fine — this is not a secret admin credential)

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --dry-run             Print planned changes only
  --seed                Also seed the "Invite Approvers" group and sync admin users into it
  --only=<collection>   Limit to one definition (e.g. case_invites)
  --help

Examples:
  node scripts/directus-schema/ensure-schema.mjs --dry-run
  node scripts/directus-schema/ensure-schema.mjs --seed
  node scripts/directus-schema/ensure-schema.mjs --only=case_invites
  node scripts/directus-schema/ensure-schema.mjs --paste-token
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if ((process.env.DIRECTUS_SCHEMA_TOKEN || '').trim()) {
        console.warn(
            'Note: DIRECTUS_SCHEMA_TOKEN is set in the environment but ignored.\n'
            + 'Use interactive --login (default) or --paste-token instead of storing admin tokens.'
        );
    }

    const url = (process.env.DIRECTUS_URL || '').trim();
    if (!url) {
        console.error('Missing DIRECTUS_URL');
        process.exit(1);
    }

    const defs = args.only
        ? DEFINITIONS.filter((d) => d.collection === args.only)
        : DEFINITIONS;
    if (args.only && defs.length === 0) {
        console.error(`Unknown collection "${args.only}". Known: ${DEFINITIONS.map((d) => d.collection).join(', ')}`);
        process.exit(1);
    }

    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(`Directus: ${url}`);
        console.log(`Auth:     ${auth.source}`);
        console.log(`Mode:     ${args.dryRun ? 'dry-run' : 'apply'}`);
        console.log('');

        const client = createDirectusAdminClient({ url, token: auth.token });

        try {
            await client.get('/collections');
        } catch (err) {
            console.error(
                `Cannot list collections (${err.status || '?'}): ${err.message}\n`
                + 'You must sign in as a Directus Administrator (not a case admin).'
            );
            process.exit(1);
        }

        for (const def of defs) {
            console.log(`▸ ${def.collection}`);
            const plan = await ensureDefinition(client, def, { dryRun: args.dryRun });
            for (const line of plan) {
                console.log(`  - ${line}`);
            }
            console.log('');
        }

        if (args.seed || args.dryRun) {
            await seedInviteApprovers(client, { dryRun: args.dryRun });
        }

        if (args.dryRun) {
            console.log('Dry-run only — no changes applied.');
        } else {
            console.log('Done.');
            if (!args.seed) {
                console.log('Tip: run with --seed to create the "Invite Approvers" group and sync admin users.');
            }
            console.log(
                'Next: grant clinician policies on case_invites when the BFF cuts over '
                + '(see docs/directus-schema-setup.md). Until then, leave the collection admin-only.'
            );
        }
    } finally {
        if (refreshToken) {
            await logoutDirectus(url, refreshToken);
        }
    }
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
