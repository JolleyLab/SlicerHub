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

loadRepoEnv();

const DEFINITIONS = Object.freeze([caseInvitesDefinition, attachmentAccountabilityDefinition]);

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
  --only=<collection>   Limit to one definition (e.g. case_invites)
  --help

Examples:
  node scripts/directus-schema/ensure-schema.mjs --dry-run
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

        if (args.dryRun) {
            console.log('Dry-run only — no changes applied.');
        } else {
            console.log('Done.');
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
