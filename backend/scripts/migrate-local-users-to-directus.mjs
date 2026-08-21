/**
 * Backfill: create Directus users + identity links for local product users.
 *
 * IMPORTANT — database path:
 *   Docker backend uses DB_PATH=/app/data/users.db (named volume).
 *   Host default is backend/data/users.db (seed only — not the live app DB).
 *   Run migrate **inside the backend container** so links land where the app reads.
 *
 * Usage:
 *   # Correct when using docker compose (recommended):
 *   docker compose exec backend node scripts/migrate-local-users-to-directus.mjs --dry-run
 *   docker compose exec backend node scripts/migrate-local-users-to-directus.mjs
 *
 *   # Host-only backend (no Docker DB volume):
 *   node backend/scripts/migrate-local-users-to-directus.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"'))
            || (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = val;
        }
    }
}

// Prefer env injected by compose; fill missing from host files when present
loadEnvFile(path.join(repoRoot, '.env'));
loadEnvFile(path.join(backendRoot, '.env'));

const src = (rel) => pathToFileURL(path.join(backendRoot, 'src', rel)).href;

const { default: User } = await import(src('models/User.js'));
const { hasDirectusIdentity } = await import(src('auth/identityStore.js'));
const { provisionOneUser } = await import(src('services/userProvision.js'));
const config = (await import(src('config/index.js'))).default;

function parseArgs(argv) {
    const out = { dryRun: false, temporaryPassword: null };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--dry-run') out.dryRun = true;
        else if (a === '--password' || a === '--temporary-password') {
            out.temporaryPassword = argv[i + 1] || null;
            i += 1;
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log(`Using DB: ${config.database.path}`);
    console.warn(
        'IMPORTANT: sql.js keeps the DB in memory per process. '
        + 'Do not run this while the app backend is also writing. Prefer:\n'
        + '  docker compose stop backend\n'
        + '  docker compose run --rm --no-deps backend node scripts/migrate-local-users-to-directus.mjs\n'
        + '  docker compose start backend\n'
        + 'Or use AUTH_LINK_POLICY=email / provisioned must_change_password auto-link on first login.'
    );

    if (!config.directus.url || !config.directus.token) {
        console.error('Need DIRECTUS_URL and DIRECTUS_TOKEN (service account).');
        process.exit(1);
    }
    if (!config.directus.defaultRoleId) {
        console.error('Need DIRECTUS_DEFAULT_ROLE_ID (clinician/non-admin role UUID).');
        process.exit(1);
    }

    const all = User.getAll().filter((u) => u.is_active !== 0 && u.is_active !== false);
    const pending = all.filter((u) => !hasDirectusIdentity(u.id));

    console.log(
        `Local users: ${all.length}; already linked: ${all.length - pending.length}; to provision/link: ${pending.length}`
    );
    if (args.dryRun) {
        for (const u of pending) {
            console.log(`  [dry-run] would provision/link ${u.email} (id=${u.id}, user=${u.username})`);
        }
        process.exit(0);
    }

    if (!pending.length) {
        console.log('Nothing to do (all local users already have a Directus link in this DB).');
        process.exit(0);
    }

    const summary = { created: 0, linked: 0, errors: 0, skip: 0 };
    const secrets = [];

    for (const u of pending) {
        if (!u.email || !String(u.email).includes('@')) {
            console.warn(`  skip id=${u.id} (${u.username}): no email`);
            summary.skip += 1;
            continue;
        }

        const result = await provisionOneUser(
            {
                email: u.email,
                username: u.username
            },
            {
                method: 'temp_password',
                temporaryPassword: args.temporaryPassword || undefined
            }
        );

        const line = `  ${u.email} → ${result.status}${result.error ? `: ${result.error}` : ''}`;
        if (result.status === 'error' || result.status === 'not_implemented') {
            console.error(line);
            summary.errors += 1;
            continue;
        }

        if (result.temporaryPassword) {
            secrets.push({ email: u.email, temporaryPassword: result.temporaryPassword });
        }

        if (result.status === 'created') summary.created += 1;
        else summary.linked += 1;
        console.log(line);
    }

    console.log('\nSummary:', summary);
    if (secrets.length) {
        console.log('\nTemporary passwords (new Directus users only; capture now):');
        for (const s of secrets) {
            console.log(`  ${s.email}\t${s.temporaryPassword}`);
        }
    } else {
        console.log(
            '\nNo new temp passwords (Directus users already existed). '
            + 'Use the original temp password, or reset password in Directus / via change-password after link.'
        );
    }
    console.log(
        '\nThen sign in with AUTH_PROVIDER=directus (email+password).'
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
