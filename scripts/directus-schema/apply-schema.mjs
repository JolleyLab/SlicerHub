/**
 * Replay a schema export (from export-schema.mjs) onto another Directus instance.
 *
 * Never destructive by default: the schema half (collections/fields/relations) only
 * applies if the diff against the target is purely additive — anything that would edit
 * or delete something already on the target is reported and skipped unless you pass
 * --allow-changes. The access-control half (roles/policies/permissions/role-level
 * access) only ever creates what's missing, matched by name or by content — it never
 * edits or deletes anything that already exists on the target.
 *
 * Security model (same as ensure-schema.mjs):
 * - CLI only. Never expose as a product HTTP route.
 * - Auth is on-demand: interactive Directus Administrator login, or a one-run
 *   pasted token. Nothing admin-level is stored in .env.
 *
 * --in accepts either output format from export-schema.mjs: a .json data file, or a
 * committed .mjs/.js module (export default {...}) — the module form needs no access to
 * the source Directus instance at all, since the schema is baked into the file itself.
 *
 * Usage:
 *   node scripts/directus-schema/apply-schema.mjs --in=./export.json --target-url=https://other-instance --dry-run
 *   node scripts/directus-schema/apply-schema.mjs --in=./export.json --target-url=https://other-instance
 *   node scripts/directus-schema/apply-schema.mjs --in=./export.json --target-url=https://other-instance --allow-changes
 *   node scripts/directus-schema/apply-schema.mjs --in=./snapshots/current-setup.mjs --target-url=https://other-instance
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadRepoEnv } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { logoutDirectus } from './lib/login.mjs';
import { resolveAuth, parseAuthFlags } from './lib/auth.mjs';
import { applyAccessControl } from './lib/accessControl.mjs';
import { applySchemaSnapshot } from './lib/schemaDiff.mjs';

loadRepoEnv();

function parseArgs(argv) {
    const auth = parseAuthFlags(argv);
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--in=')) opts.in = arg.slice('--in='.length).trim();
        else if (arg.startsWith('--target-url=')) opts.targetUrl = arg.slice('--target-url='.length).trim();
    }
    return {
        ...auth,
        login: !auth.pasteToken && !auth.allowServiceToken,
        allowChanges: flags.has('allow-changes'),
        in: opts.in || null,
        targetUrl: opts.targetUrl || null
    };
}

function printHelp() {
    console.log(`Apply a schema export (export-schema.mjs output) onto another Directus instance.

Requires:
  --in=<path>         export-schema.mjs output: a .json data file, or a committed .mjs/.js
                      module (export default {...}) — the module form needs no access to
                      the original source Directus instance at all.
  --target-url=<url>  The instance to apply it to (deliberately separate from DIRECTUS_URL
                       so you can never apply to your own .env instance by accident)

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --dry-run        Print what would change, apply nothing
  --allow-changes  Also apply schema edits/deletions the diff reports (default: only
                   ever add new collections/fields/relations; refuse if the diff
                   would touch anything that already exists on the target)
  --help

Access control (roles / policies / permissions / role-level access) is always additive-only
— this flag only affects the schema (data model) half of the apply.

Examples:
  node scripts/directus-schema/apply-schema.mjs --in=./exports/foo.json --target-url=https://staging.example.com --dry-run
  node scripts/directus-schema/apply-schema.mjs --in=./exports/foo.json --target-url=https://staging.example.com
  node scripts/directus-schema/apply-schema.mjs --in=./snapshots/current-setup.mjs --target-url=https://my-own-instance
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    if (!args.in) {
        console.error('Missing --in=<path to export JSON>');
        process.exit(1);
    }
    if (!args.targetUrl) {
        console.error('Missing --target-url=<url> (the instance to apply to)');
        process.exit(1);
    }

    const inPath = path.resolve(args.in);
    if (!fs.existsSync(inPath)) {
        console.error(`Export file not found: ${inPath}`);
        process.exit(1);
    }
    const exported = /\.(mjs|js)$/.test(inPath)
        ? (await import(pathToFileURL(inPath).href)).default
        : JSON.parse(fs.readFileSync(inPath, 'utf8'));
    if (!exported || !exported.schemaSnapshot) {
        console.error(`${inPath} doesn't look like an export-schema.mjs output (missing schemaSnapshot).`);
        process.exit(1);
    }

    const url = args.targetUrl;
    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(`Export:   ${inPath}`);
        console.log(`  from:   ${exported.sourceUrl || 'unknown'} (exported ${exported.exportedAt || 'unknown'})`);
        console.log(`Target:   ${url}`);
        console.log(`Auth:     ${auth.source}`);
        console.log(`Mode:     ${args.dryRun ? 'dry-run' : 'apply'}`);
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

        console.log('▸ schema (collections / fields / relations)');
        const schemaResult = await applySchemaSnapshot(client, exported.schemaSnapshot, {
            dryRun: args.dryRun,
            allowChanges: args.allowChanges
        });
        if (!schemaResult.hasDiff) {
            console.log('  - target schema already matches source — nothing to do');
        } else if (!schemaResult.additiveOnly) {
            console.log('  - found changes that would edit or delete something already on the target:');
            for (const line of schemaResult.nonAdditive) {
                console.log(`      ${line}`);
            }
        }
        console.log(`  ${schemaResult.message}`);
        console.log('');

        console.log('▸ access control (roles / policies / permissions)');
        const accessReport = await applyAccessControl(client, exported, { dryRun: args.dryRun });
        for (const [section, lines] of Object.entries(accessReport)) {
            if (lines.length === 0) continue;
            console.log(`  ${section}:`);
            for (const line of lines) console.log(`    - ${line}`);
        }
        console.log('');

        console.log(args.dryRun ? 'Dry-run only — no changes applied.' : 'Done.');
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
