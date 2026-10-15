/**
 * First-time Directus setup: bootstrap a fresh instance into the same working state as
 * the project's maintained reference — in one command. This is what a new developer (or,
 * eventually, a prod rollout) runs against an empty/fresh Directus instance.
 *
 * Does three things, in order, all idempotent / safe to re-run:
 *   1. Schema (collections / fields / relations) from the committed reference-schema.mjs,
 *      via Directus's own /schema/diff + /schema/apply — additive-only unless --allow-changes.
 *   2. Roles / policies / permissions / role-level access from the same reference file —
 *      always additive-only, matched by name or content, never edits what already exists.
 *   3. Seeds the "Registration Reviewers" group and syncs current admin users into it.
 *
 * The reference file is a point-in-time snapshot (see export-schema.mjs --format=module) —
 * it does not track the source instance live. Regenerate and commit it when the maintained
 * instance's schema changes:
 *   node scripts/directus-schema/export-schema.mjs --format=module \
 *     --out=scripts/directus-schema/reference-schema.mjs
 *
 * Security model (same as ensure-schema.mjs):
 * - CLI only. Never expose as a product HTTP route.
 * - Auth is on-demand: interactive Directus Administrator login, or a one-run
 *   pasted token. Nothing admin-level is stored in .env.
 *
 * Usage:
 *   node scripts/directus-schema/setup.mjs --target-url=https://your-fresh-instance --dry-run
 *   node scripts/directus-schema/setup.mjs --target-url=https://your-fresh-instance
 *   node scripts/directus-schema/setup.mjs --target-url=https://your-fresh-instance --allow-changes
 *
 * Prod: same command, same safety guarantees — but dry-run it first, and prefer trying it
 * against a scratch/staging instance before ever pointing it at real prod.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadRepoEnv, schemaScriptRoot } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { logoutDirectus } from './lib/login.mjs';
import { resolveAuth, parseAuthFlags } from './lib/auth.mjs';
import { applyAccessControl } from './lib/accessControl.mjs';
import { applySchemaSnapshot } from './lib/schemaDiff.mjs';
import { seedInviteApprovers } from './lib/seed.mjs';

loadRepoEnv();

const DEFAULT_REFERENCE_PATH = path.join(schemaScriptRoot, 'reference-schema.mjs');

function parseArgs(argv) {
    const auth = parseAuthFlags(argv);
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--target-url=')) opts.targetUrl = arg.slice('--target-url='.length).trim();
        else if (arg.startsWith('--reference=')) opts.reference = arg.slice('--reference='.length).trim();
    }
    return {
        ...auth,
        login: !auth.pasteToken && !auth.allowServiceToken,
        allowChanges: flags.has('allow-changes'),
        noSeed: flags.has('no-seed'),
        targetUrl: opts.targetUrl || null,
        reference: opts.reference || null
    };
}

function printHelp() {
    console.log(`First-time Directus setup — bootstrap a fresh instance in one command.

Requires:
  --target-url=<url>  The fresh/empty instance to set up (deliberately separate from
                       DIRECTUS_URL so you can't apply to your own .env instance by accident)

Also requires scripts/directus-schema/reference-schema.mjs to exist (the maintainer
generates and commits it — see export-schema.mjs --format=module).

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --dry-run        Print what would change, apply nothing
  --allow-changes  Also apply schema edits/deletions the diff reports (default: only
                   ever add new collections/fields/relations)
  --no-seed        Skip seeding the "Registration Reviewers" group / admin sync
  --reference=<path>  Use a different reference file instead of reference-schema.mjs
  --help

Examples:
  node scripts/directus-schema/setup.mjs --target-url=https://my-fresh-instance --dry-run
  node scripts/directus-schema/setup.mjs --target-url=https://my-fresh-instance
`);
}

async function loadReference(refPath) {
    if (!fs.existsSync(refPath)) {
        console.error(
            `Reference file not found: ${refPath}\n\n`
            + 'This project has not committed one yet. The maintainer generates it with:\n'
            + '  node scripts/directus-schema/export-schema.mjs --format=module '
            + `--out=${refPath}`
        );
        process.exit(1);
    }
    const data = /\.(mjs|js)$/.test(refPath)
        ? (await import(pathToFileURL(refPath).href)).default
        : JSON.parse(fs.readFileSync(refPath, 'utf8'));
    if (!data || !data.schemaSnapshot) {
        console.error(`${refPath} doesn't look like an export-schema.mjs output (missing schemaSnapshot).`);
        process.exit(1);
    }
    return data;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if (!args.targetUrl) {
        console.error('Missing --target-url=<url> (the fresh instance to set up)');
        process.exit(1);
    }

    const refPath = args.reference ? path.resolve(args.reference) : DEFAULT_REFERENCE_PATH;
    const reference = await loadReference(refPath);

    const url = args.targetUrl;
    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(`Reference: ${refPath}`);
        console.log(`Target:    ${url}`);
        console.log(`Auth:      ${auth.source}`);
        console.log(`Mode:      ${args.dryRun ? 'dry-run' : 'apply'}`);
        console.log('');

        const client = createDirectusAdminClient({ url, token: auth.token });

        try {
            await client.get('/collections');
        } catch (err) {
            console.error(
                `Cannot list collections on target (${err.status || '?'}): ${err.message}\n`
                + 'You must sign in as a Directus Administrator on the TARGET instance.'
            );
            process.exit(1);
        }

        console.log('▸ 1/3 schema (collections / fields / relations)');
        const schemaResult = await applySchemaSnapshot(client, reference.schemaSnapshot, {
            dryRun: args.dryRun,
            allowChanges: args.allowChanges
        });
        if (!schemaResult.hasDiff) {
            console.log('  - target schema already matches reference — nothing to do');
        } else if (!schemaResult.additiveOnly) {
            console.log('  - found changes that would edit or delete something already on the target:');
            for (const line of schemaResult.nonAdditive) {
                console.log(`      ${line}`);
            }
        }
        console.log(`  ${schemaResult.message}`);
        console.log('');

        console.log('▸ 2/3 access control (roles / policies / permissions)');
        const accessReport = await applyAccessControl(client, reference, { dryRun: args.dryRun });
        for (const [section, lines] of Object.entries(accessReport)) {
            if (lines.length === 0) continue;
            console.log(`  ${section}:`);
            for (const line of lines) console.log(`    - ${line}`);
        }
        console.log('');

        console.log('▸ 3/3 seed');
        if (args.noSeed) {
            console.log('  - skipped (--no-seed)');
            console.log('');
        } else {
            await seedInviteApprovers(client, { dryRun: args.dryRun });
        }

        console.log(args.dryRun ? 'Dry-run only — no changes applied.' : 'Done. Target instance is set up.');
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
