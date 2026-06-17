import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import config from '../config/index.js';
import db, { flushDatabase } from '../db/database.js';
import { decryptCredentials } from './credentials.js';
import { verifyVastApiKey } from './providers/vast/client.js';

async function readCredentialRows(dbPath) {
    if (!fs.existsSync(dbPath)) return new Map();
    const sql = await initSqlJs();
    const handle = new sql.Database(fs.readFileSync(dbPath));
    try {
        const result = handle.exec(
            'SELECT project_id, credentials_enc FROM project_gpu_settings WHERE credentials_enc IS NOT NULL'
        );
        const rows = new Map();
        for (const [projectId, credentialsEnc] of result[0]?.values || []) {
            rows.set(Number(projectId), String(credentialsEnc || ''));
        }
        return rows;
    } finally {
        handle.close();
    }
}

function vastApiKeyFromBlob(blob) {
    const decrypted = decryptCredentials(blob);
    if (!decrypted) return '';
    return String(decrypted.providers?.vast?.apiKey || decrypted.apiKey || '').trim();
}

async function isVastKeyValid(apiKey) {
    if (!apiKey) return false;
    try {
        await verifyVastApiKey(apiKey);
        return true;
    } catch {
        return false;
    }
}

/**
 * If the live DB has a broken Vast key but the read-only seed DB still has a
 * valid one, restore credentials_enc from seed (sql.js write corruption recovery).
 */
export async function repairGpuCredentialsFromSeed() {
    const seedPath = process.env.DB_SEED_PATH || '/app/data-seed/users.db';
    const livePath = config.database.path;
    if (!fs.existsSync(seedPath) || path.resolve(seedPath) === path.resolve(livePath)) {
        return { repaired: 0 };
    }

    const [seedRows, liveRows] = await Promise.all([
        readCredentialRows(seedPath),
        readCredentialRows(livePath)
    ]);

    let repaired = 0;
    for (const [projectId, seedEnc] of seedRows) {
        const liveEnc = liveRows.get(projectId) || '';
        if (!seedEnc || seedEnc === liveEnc) continue;

        const liveKey = vastApiKeyFromBlob(liveEnc);
        const seedKey = vastApiKeyFromBlob(seedEnc);
        if (!seedKey) continue;

        const liveValid = liveKey ? await isVastKeyValid(liveKey) : false;
        if (liveValid) continue;

        const seedValid = await isVastKeyValid(seedKey);
        if (!seedValid) continue;

        db.prepare(`
            UPDATE project_gpu_settings
            SET credentials_enc = ?, updated_at = CURRENT_TIMESTAMP
            WHERE project_id = ?
        `).run(seedEnc, projectId);
        repaired += 1;
        console.log(`Restored GPU credentials for project ${projectId} from seed database`);
    }

    if (repaired > 0) {
        flushDatabase();
    }
    return { repaired };
}
