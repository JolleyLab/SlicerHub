/**
 * Generates bootstrap.mjs — a single, self-contained, committable setup script — from a
 * local extraction (export-schema.mjs --format=module output, e.g. reference-schema.mjs).
 *
 * Pure local file transform: no network access, no Directus credentials needed to run this.
 * The extraction stays local/gitignored; only the generated bootstrap.mjs is meant to be
 * committed. Re-run this whenever the extraction is refreshed to update bootstrap.mjs to
 * match:
 *   1. node scripts/directus-schema/export-schema.mjs --format=module --out=scripts/directus-schema/reference-schema.mjs
 *   2. node scripts/directus-schema/generate-bootstrap.mjs
 *   3. review the diff to scripts/directus-schema/bootstrap.mjs, commit it
 *
 * Usage:
 *   node scripts/directus-schema/generate-bootstrap.mjs
 *   node scripts/directus-schema/generate-bootstrap.mjs --in=<path> --out=<path>
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { schemaScriptRoot } from './lib/env.mjs';

const DEFAULT_IN = path.join(schemaScriptRoot, 'reference-schema.mjs');
const DEFAULT_OUT = path.join(schemaScriptRoot, 'bootstrap.mjs');

function parseArgs(argv) {
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--in=')) opts.in = arg.slice('--in='.length).trim();
        else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length).trim();
    }
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        in: opts.in ? path.resolve(opts.in) : DEFAULT_IN,
        out: opts.out ? path.resolve(opts.out) : DEFAULT_OUT
    };
}

function printHelp() {
    console.log(`Generate bootstrap.mjs (a self-contained setup script) from a local extraction.

Flags:
  --in=<path>   Extraction to read (export-schema.mjs output, .mjs or .json). Default:
                scripts/directus-schema/reference-schema.mjs
  --out=<path>  Where to write the generated script. Default:
                scripts/directus-schema/bootstrap.mjs
  --help

This never touches the network — it only reads a local file and writes another.
`);
}

async function loadExtraction(inPath) {
    if (!fs.existsSync(inPath)) {
        console.error(
            `Extraction file not found: ${inPath}\n\n`
            + 'Generate one first (needs a real Directus admin login):\n'
            + `  node scripts/directus-schema/export-schema.mjs --format=module --out=${inPath}`
        );
        process.exit(1);
    }
    const data = /\.(mjs|js)$/.test(inPath)
        ? (await import(pathToFileURL(inPath).href)).default
        : JSON.parse(fs.readFileSync(inPath, 'utf8'));
    if (!data || !data.schemaSnapshot) {
        console.error(`${inPath} doesn't look like an export-schema.mjs output (missing schemaSnapshot).`);
        process.exit(1);
    }
    return data;
}

function render(data, { inPath }) {
    const generatedAt = new Date().toISOString();
    return `/**
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *   node scripts/directus-schema/generate-bootstrap.mjs
 *
 * Built ${generatedAt} from ${path.basename(inPath)}
 * (that extraction was taken ${data.exportedAt || 'at an earlier point'}).
 *
 * This is a ONE-TIME SETUP SCRIPT, not a live mirror of any server: the model below
 * (roles, policies, permissions, role-level access, and the full data model) is a
 * point-in-time snapshot, hard-coded here. It will NOT track future changes to the
 * source instance on its own.
 *
 * To refresh it after the source schema changes:
 *   1. node scripts/directus-schema/export-schema.mjs --format=module \\
 *        --out=scripts/directus-schema/reference-schema.mjs
 *   2. node scripts/directus-schema/generate-bootstrap.mjs
 *   3. review the diff to this file, commit it
 *
 * Run this file directly to set up a target instance — never destructive by default:
 *   node scripts/directus-schema/bootstrap.mjs --target-url=<url> --dry-run
 *   node scripts/directus-schema/bootstrap.mjs --target-url=<url>
 *
 * Schema (collections/fields/relations) only applies if every change against the target
 * is a pure addition; pass --allow-changes to also apply edits/deletions. Roles / policies
 * / permissions / access are always additive-only — matched by name or content, existing
 * ones are never edited. Security model same as ensure-schema.mjs: CLI only, interactive
 * Directus Administrator login by default (or --paste-token), nothing admin-level ever
 * touches .env.
 *
 * Usage:
 *   node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance --dry-run
 *   node scripts/directus-schema/bootstrap.mjs --target-url=https://your-fresh-instance
 *
 * Prod: same command, same safety guarantees — but dry-run it first, and prefer trying it
 * against a scratch/staging instance before ever pointing it at real prod.
 */

import { loadRepoEnv } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { logoutDirectus } from './lib/login.mjs';
import { resolveAuth, parseAuthFlags } from './lib/auth.mjs';
import { applyAccessControl } from './lib/accessControl.mjs';
import { applySchemaSnapshot } from './lib/schemaDiff.mjs';
import { seedInviteApprovers } from './lib/seed.mjs';

loadRepoEnv();

// --- The hard-coded model (see the file header for how to refresh these) ---

const SCHEMA_SNAPSHOT = ${JSON.stringify(data.schemaSnapshot, null, 2)};

const ROLES = ${JSON.stringify(data.roles, null, 2)};

const POLICIES = ${JSON.stringify(data.policies, null, 2)};

const PERMISSIONS = ${JSON.stringify(data.permissions, null, 2)};

const ACCESS = ${JSON.stringify(data.access, null, 2)};

// --- CLI (identical shape to setup.mjs, minus reading an external reference file) ---

function parseArgs(argv) {
    const auth = parseAuthFlags(argv);
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--target-url=')) opts.targetUrl = arg.slice('--target-url='.length).trim();
    }
    return {
        ...auth,
        login: !auth.pasteToken && !auth.allowServiceToken,
        allowChanges: flags.has('allow-changes'),
        noSeed: flags.has('no-seed'),
        targetUrl: opts.targetUrl || null
    };
}

function printHelp() {
    console.log(\`One-time Directus setup — hard-coded model, generated ${generatedAt}.

Requires:
  --target-url=<url>  The fresh/empty instance to set up (deliberately separate from
                       DIRECTUS_URL so you can't apply to your own .env instance by accident)

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --dry-run        Print what would change, apply nothing
  --allow-changes  Also apply schema edits/deletions the diff reports (default: only
                   ever add new collections/fields/relations)
  --no-seed        Skip seeding the "Registration Reviewers" group / admin sync
  --help

Examples:
  node scripts/directus-schema/bootstrap.mjs --target-url=https://my-fresh-instance --dry-run
  node scripts/directus-schema/bootstrap.mjs --target-url=https://my-fresh-instance
\`);
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

    const url = args.targetUrl;
    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(\`Target: \${url}\`);
        console.log(\`Auth:   \${auth.source}\`);
        console.log(\`Mode:   \${args.dryRun ? 'dry-run' : 'apply'}\`);
        console.log('');

        const client = createDirectusAdminClient({ url, token: auth.token });

        try {
            await client.get('/collections');
        } catch (err) {
            console.error(
                \`Cannot list collections on target (\${err.status || '?'}): \${err.message}\\n\`
                + 'You must sign in as a Directus Administrator on the TARGET instance.'
            );
            process.exit(1);
        }

        console.log('▸ 1/3 schema (collections / fields / relations)');
        const schemaResult = await applySchemaSnapshot(client, SCHEMA_SNAPSHOT, {
            dryRun: args.dryRun,
            allowChanges: args.allowChanges
        });
        if (!schemaResult.hasDiff) {
            console.log('  - target schema already matches — nothing to do');
        } else if (!schemaResult.additiveOnly) {
            console.log('  - found changes that would edit or delete something already on the target:');
            for (const line of schemaResult.nonAdditive) {
                console.log(\`      \${line}\`);
            }
        }
        console.log(\`  \${schemaResult.message}\`);
        console.log('');

        console.log('▸ 2/3 access control (roles / policies / permissions)');
        const accessReport = await applyAccessControl(
            client,
            { roles: ROLES, policies: POLICIES, permissions: PERMISSIONS, access: ACCESS },
            { dryRun: args.dryRun }
        );
        for (const [section, lines] of Object.entries(accessReport)) {
            if (lines.length === 0) continue;
            console.log(\`  \${section}:\`);
            for (const line of lines) console.log(\`    - \${line}\`);
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
`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }
    const data = await loadExtraction(args.in);
    const source = render(data, { inPath: args.in });
    fs.writeFileSync(args.out, source);
    console.log(`Wrote ${args.out}`);
    console.log('Review the diff before committing — it hard-codes the model from the extraction above.');
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
