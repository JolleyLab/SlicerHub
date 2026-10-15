/**
 * Export a full Directus schema snapshot (collections / fields / relations) plus
 * role-level access control (roles, policies, permissions, role/public policy
 * attachments) — for replicating onto another Directus instance with apply-schema.mjs.
 *
 * Two output formats:
 *   --format=json (default)  Plain JSON data dump. Written under scripts/directus-schema/exports/,
 *                             which is git-ignored — meant to be shared out-of-band (not committed),
 *                             and apply-schema.mjs's recipient needs no access to the source Directus.
 *   --format=module          The same payload as a committed .mjs source file (export default {...}).
 *                             Point-in-time — it does NOT stay in sync with the source; regenerate
 *                             and commit again if the source schema changes. Use this when you want
 *                             "what my setup looks like right now" checked into git for someone else
 *                             to run apply-schema.mjs against their own server, without ever handing
 *                             them a data file or Directus access.
 *
 * Schema only, never data: no items from case/user/file collections are touched,
 * and user-linked policy attachments (one person's individual access) are excluded
 * since a user id from this instance has no meaning on another one.
 *
 * Security model (same as ensure-schema.mjs):
 * - CLI only. Never expose as a product HTTP route.
 * - Auth is on-demand: interactive Directus Administrator login, or a one-run
 *   pasted token. Nothing admin-level is stored in .env.
 *
 * Usage:
 *   node scripts/directus-schema/export-schema.mjs
 *   node scripts/directus-schema/export-schema.mjs --url=https://other-instance --paste-token
 *   node scripts/directus-schema/export-schema.mjs --out=./my-export.json
 *   node scripts/directus-schema/export-schema.mjs --format=module --out=scripts/directus-schema/snapshots/current-setup.mjs
 */

import fs from 'fs';
import path from 'path';
import { loadRepoEnv, schemaScriptRoot } from './lib/env.mjs';
import { createDirectusAdminClient } from './lib/client.mjs';
import { logoutDirectus } from './lib/login.mjs';
import { resolveAuth, parseAuthFlags } from './lib/auth.mjs';
import { exportAccessControl } from './lib/accessControl.mjs';

loadRepoEnv();

function parseArgs(argv) {
    const auth = parseAuthFlags(argv);
    const flags = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
    const opts = {};
    for (const arg of argv) {
        if (arg.startsWith('--url=')) opts.url = arg.slice('--url='.length).trim();
        else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length).trim();
        else if (arg.startsWith('--format=')) opts.format = arg.slice('--format='.length).trim();
    }
    const format = opts.format === 'module' ? 'module' : 'json';
    return {
        ...auth,
        login: !auth.pasteToken && !auth.allowServiceToken,
        url: opts.url || null,
        out: opts.out || null,
        format,
        includeSourceUrl: flags.has('include-source-url')
    };
}

function printHelp() {
    console.log(`Export a Directus schema (data model + role-level access control) to JSON.

Requires:
  DIRECTUS_URL   the source instance, unless --url=<url> is passed

Auth (pick one; nothing admin is stored in .env):
  default / --login     Interactive Directus Administrator email + password (+ OTP)
  --paste-token         Paste a one-run access/static token (not saved)
  --allow-service-token Lab only: reuse DIRECTUS_TOKEN if it is admin

Flags:
  --url=<url>            Export from this instance instead of DIRECTUS_URL
  --out=<path>           Write the export here (default under scripts/directus-schema/exports/
                         for json, scripts/directus-schema/snapshots/ for module)
  --format=json|module   json (default): plain data file, meant to stay out of git.
                         module: a committable .mjs source file (export default {...}) — a
                         point-in-time snapshot someone else can run apply-schema.mjs against
                         without needing access to this instance or the json file.
  --include-source-url   module format redacts the source URL by default (it's otherwise about
                         to be committed to git); pass this to keep it in the generated file.
  --help

What's included:
  - Full schema snapshot (collections, fields, relations) via Directus's own /schema/snapshot
  - Roles, policies, permissions
  - Role-level and public policy attachments (directus_access rows with no user)

What's excluded (always):
  - Any item data (cases, users, files, ...) — schema only
  - User-linked policy attachments — a user id from this instance means nothing elsewhere

Examples:
  node scripts/directus-schema/export-schema.mjs
  node scripts/directus-schema/export-schema.mjs --url=https://staging.example.com --paste-token
  node scripts/directus-schema/export-schema.mjs --format=module --out=scripts/directus-schema/snapshots/current-setup.mjs
`);
}

function defaultOutPath(url, format) {
    const host = (() => {
        try { return new URL(url).hostname; } catch { return 'directus'; }
    })();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'module') {
        return path.join(schemaScriptRoot, 'snapshots', `${host}-${stamp}.mjs`);
    }
    return path.join(schemaScriptRoot, 'exports', `${host}-${stamp}.json`);
}

/** A committable ES module: `export default { ...payload };` — plain data, no functions. */
function toModuleSource(payload) {
    return `/**\n`
        + ` * Generated by export-schema.mjs — a point-in-time Directus schema snapshot.\n`
        + ` * Exported: ${payload.exportedAt}\n`
        + ` *\n`
        + ` * This does NOT stay in sync with the source instance. If the source schema changes,\n`
        + ` * regenerate and commit again:\n`
        + ` *   node scripts/directus-schema/export-schema.mjs --format=module --out=<this file>\n`
        + ` *\n`
        + ` * Apply it to another instance with:\n`
        + ` *   node scripts/directus-schema/apply-schema.mjs --in=<this file> --target-url=<other-url>\n`
        + ` */\n\n`
        + `export default ${JSON.stringify(payload, null, 2)};\n`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    const url = (args.url || process.env.DIRECTUS_URL || '').trim();
    if (!url) {
        console.error('Missing DIRECTUS_URL (or pass --url=<url>)');
        process.exit(1);
    }

    let refreshToken = null;
    try {
        const auth = await resolveAuth(url, args);
        refreshToken = auth.refreshToken;

        console.log(`Source:   ${url}`);
        console.log(`Auth:     ${auth.source}`);
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

        console.log('▸ schema snapshot');
        const schemaSnapshot = await client.get('/schema/snapshot');
        console.log(`  - directus version: ${schemaSnapshot?.directus || 'unknown'}`);
        console.log(`  - collections:      ${(schemaSnapshot?.collections || []).length}`);
        console.log(`  - fields:           ${(schemaSnapshot?.fields || []).length}`);
        console.log(`  - relations:        ${(schemaSnapshot?.relations || []).length}`);
        console.log('');

        console.log('▸ access control (roles / policies / permissions)');
        let accessControl;
        try {
            accessControl = await exportAccessControl(client);
        } catch (err) {
            console.error(
                `Could not export policies/access (${err.status || '?'}): ${err.message}\n`
                + 'This Directus version may predate the Policies model (pre-10.10), '
                + 'where permissions attach directly to roles instead. This script does '
                + 'not yet support that older model — export aborted.'
            );
            process.exit(1);
        }
        console.log(`  - roles:       ${accessControl.roles.length}`);
        console.log(`  - policies:    ${accessControl.policies.length}`);
        console.log(`  - permissions: ${accessControl.permissions.length}`);
        console.log(`  - access rows: ${accessControl.access.length} (role-level / public only)`);
        console.log('');

        const outPath = args.out ? path.resolve(args.out) : defaultOutPath(url, args.format);
        const redactSourceUrl = args.format === 'module' && !args.includeSourceUrl;
        const payload = {
            exportedAt: new Date().toISOString(),
            sourceUrl: redactSourceUrl ? '(redacted — pass --include-source-url to keep this)' : url,
            schemaSnapshot,
            ...accessControl
        };

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(
            outPath,
            args.format === 'module' ? toModuleSource(payload) : JSON.stringify(payload, null, 2)
        );
        console.log(`Wrote ${outPath}`);
        if (args.format === 'module') {
            console.log(
                redactSourceUrl
                    ? '(source URL redacted in the generated file — pass --include-source-url to keep it)'
                    : ''
            );
            console.log('This is a point-in-time snapshot — it will NOT track future schema changes.');
            console.log('Review it before committing (it describes your data model + role/policy structure).');
        }
        console.log('Apply it to another instance with:');
        console.log(`  node scripts/directus-schema/apply-schema.mjs --in=${outPath} --target-url=<other-url>`);
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
