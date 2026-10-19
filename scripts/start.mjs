#!/usr/bin/env node
/**
 * Infisical-aware docker compose wrapper.
 *
 * Usage (drop-in for `docker compose`):
 *   node scripts/start.mjs up -d
 *   node scripts/start.mjs up -d --profile keycloak
 *   node scripts/start.mjs logs -f backend
 *   node scripts/start.mjs down
 *
 * What it does:
 *   1. Reads INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID
 *      from .env.
 *   2. If all three are set: exchanges credentials for a short-lived access token,
 *      fetches all secrets from Infisical, and injects them into the process
 *      environment before running docker compose.
 *   3. If not configured: falls back to plain `docker compose` (secrets come
 *      from .env as before — safe during initial bootstrap).
 *
 * Swap-out path to Azure / AWS:
 *   Replace this script with platform-native secret injection (Azure Key Vault
 *   references in Container Apps, or AWS Secrets Manager in ECS task definitions).
 *   Application code never changes — it reads process.env regardless of source.
 */

import fs   from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname      = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE       = path.join(__dirname, '..', '.env')
const INFISICAL_BASE = 'http://localhost:8888'
const INFISICAL_ENV  = 'dev'

// ---------------------------------------------------------------------------
// .env reader
// ---------------------------------------------------------------------------

function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return Object.fromEntries(
        fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(line => line.includes('=') && !line.trim().startsWith('#'))
            .map(line => {
                const idx = line.indexOf('=');
                return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
            })
    );
}

// ---------------------------------------------------------------------------
// Infisical helpers
// ---------------------------------------------------------------------------

async function getAccessToken(clientId, clientSecret) {
    const res = await fetch(`${INFISICAL_BASE}/api/v1/auth/universal-auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ clientId, clientSecret }),
        signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Infisical login failed (${res.status}): ${text}`);
    }
    return (await res.json()).accessToken;
}

async function fetchSecrets(accessToken, projectId) {
    const res = await fetch(
        `${INFISICAL_BASE}/api/v3/secrets/raw?workspaceId=${projectId}&environment=${INFISICAL_ENV}&secretPath=/`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal:  AbortSignal.timeout(10000),
        }
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch secrets (${res.status}): ${text}`);
    }
    const data = await res.json();
    return Object.fromEntries((data.secrets ?? []).map(s => [s.secretKey, s.secretValue]));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node scripts/start.mjs <docker compose args...>');
        console.error('Example: node scripts/start.mjs up -d');
        process.exit(1);
    }

    const env = readEnvFile(ENV_FILE);
    const clientId     = (env.INFISICAL_CLIENT_ID     || '').trim();
    const clientSecret = (env.INFISICAL_CLIENT_SECRET || '').trim();
    const projectId    = (env.INFISICAL_PROJECT_ID    || '').trim();

    // Build the runtime environment: start with everything already in process.env
    // (which includes vars Docker Compose reads for ${VAR} interpolation).
    const runtimeEnv = { ...process.env };

    // Load non-sensitive config from .env into the runtime env so docker compose
    // can interpolate ${VAR_NAME} in docker-compose.yml.
    for (const [k, v] of Object.entries(env)) {
        if (v) runtimeEnv[k] = v;
    }

    if (clientId && clientSecret && projectId) {
        try {
            const token   = await getAccessToken(clientId, clientSecret);
            const secrets = await fetchSecrets(token, projectId);
            // Infisical secrets override .env values.
            Object.assign(runtimeEnv, secrets);
            console.log(`  [start.mjs] ${Object.keys(secrets).length} secret(s) injected from Infisical`);
        } catch (err) {
            console.warn(`  [start.mjs] ⚠  Could not fetch Infisical secrets: ${err.message}`);
            console.warn('  [start.mjs]    Falling back to .env values.');
        }
    } else {
        console.warn('  [start.mjs] Infisical not configured — using .env values (run setup-infisical.mjs to migrate)');
    }

    const result = spawnSync('docker', ['compose', ...args], {
        cwd:   path.join(__dirname, '..'),
        stdio: 'inherit',
        env:   runtimeEnv,
    });

    process.exit(result.status ?? 1);
}

main().catch(err => {
    console.error(`  [start.mjs] ✖  ${err.message}`);
    process.exit(1);
});
