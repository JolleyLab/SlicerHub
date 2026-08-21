/**
 * Force must_change_password for users (Pattern A gate).
 * Run in backend container so sql.js process/DB matches the app:
 *
 *   docker compose exec backend node scripts/set-must-change-password.mjs test@123.com
 *   docker compose exec backend node scripts/set-must-change-password.mjs --all-linked
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq <= 0) continue;
        const key = t.slice(0, eq).trim();
        let val = t.slice(eq + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"'))
            || (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

loadEnvFile(path.join(repoRoot, '.env'));
loadEnvFile(path.join(backendRoot, '.env'));

const src = (rel) => pathToFileURL(path.join(backendRoot, 'src', rel)).href;
const { default: User } = await import(src('models/User.js'));
const { hasDirectusIdentity } = await import(src('auth/identityStore.js'));
const { flushDatabase } = await import(src('db/database.js'));

const args = process.argv.slice(2);
const allLinked = args.includes('--all-linked');
const emails = args.filter((a) => a !== '--all-linked' && !a.startsWith('-'));

let targets = [];
if (allLinked) {
    targets = User.getAll().filter((u) => hasDirectusIdentity(u.id));
} else if (emails.length) {
    for (const e of emails) {
        const u = User.findByEmail(e);
        if (!u) {
            console.error(`No user for ${e}`);
            process.exitCode = 1;
            continue;
        }
        targets.push(u);
    }
} else {
    console.error('Usage: node scripts/set-must-change-password.mjs user@email.com');
    console.error('       node scripts/set-must-change-password.mjs --all-linked');
    process.exit(1);
}

for (const u of targets) {
    User.setMustChangePassword(u.id, true);
    console.log(`must_change_password=1 for ${u.email} (id=${u.id})`);
}
flushDatabase();
console.log('Saved. Sign out and sign in again to see the force-change form.');
