/**
 * Print local users vs Directus identity links (no secrets).
 * Run against the SAME DB the backend uses.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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
        if (process.env[key] === undefined) process.env[key] = val;
    }
}

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, 'backend', '.env'));

const { default: db } = await import('../backend/src/db/database.js');
const config = (await import('../backend/src/config/index.js')).default;

const users = db.prepare('SELECT id, email, username FROM users ORDER BY id').all();
const links = db.prepare(
    'SELECT user_id, provider, external_id FROM auth_identity_links WHERE provider = ?'
).all('directus');

console.log('DB path:', config.database.path);
console.log('Users:', users.length);
console.log('Directus links:', links.length);
const linkedIds = new Set(links.map((l) => l.user_id));
const unlinked = users.filter((u) => !linkedIds.has(u.id));
console.log('Unlinked users:', unlinked.length);
for (const u of unlinked) {
    console.log(`  id=${u.id} ${u.email}`);
}
for (const l of links.slice(0, 20)) {
    console.log(`  link user_id=${l.user_id} external_id=${l.external_id}`);
}
if (links.length > 20) console.log(`  ... +${links.length - 20} more`);
