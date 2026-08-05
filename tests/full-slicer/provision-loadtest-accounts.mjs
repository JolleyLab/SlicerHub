#!/usr/bin/env node
/**
 * Create N load-test users and grant them access to a My Projects project.
 * Writes tests/full-slicer/accounts.json for full-slicer-load.mjs --accounts-file.
 *
 * Requires REGISTRATION_ENABLED=true (temporarily OK on a non-public box).
 * Admin must own/admin the target project (collaborator list is replaced with merge).
 *
 * Example:
 *   node tests/full-slicer/provision-loadtest-accounts.mjs \
 *     --base-url http://localhost:8000 \
 *     --admin-user test --admin-password 12345678 \
 *     --project 2 --count 6 \
 *     --password 'LoadTest!234'
 *
 * Then:
 *   node tests/full-slicer/full-slicer-load.mjs \
 *     --base-url http://localhost:8000 \
 *     --project 2 --file-name "rHiseySlicerScene.mrb" \
 *     --accounts-file tests/full-slicer/accounts.json \
 *     --mode capacity --concurrency auto --max-concurrency 6
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
    console.log(`
Usage: node tests/full-slicer/provision-loadtest-accounts.mjs [options]

Required:
  --base-url <url>
  --admin-user <name> --admin-password <pw>   Project admin (adds collaborators)
  --project <id>
  --count <n>                                 How many loadtest users (default 4)

Optional:
  --prefix <name>           Username prefix (default loadtest)
  --password <pw>           Password for all loadtest users (default LoadTest!234)
  --out <path>              accounts.json path (default tests/full-slicer/accounts.json)
  --start-index <n>         First suffix (default 1 → loadtest1)
  --role <collaborator|observer>  Project role (default collaborator)
  --help
`.trim());
    process.exit(code);
}

function parseArgs(argv) {
    const args = {
        baseUrl: '',
        adminUser: '',
        adminPassword: '',
        projectId: null,
        count: 4,
        prefix: 'loadtest',
        password: 'LoadTest!234',
        out: path.join(__dirname, 'accounts.json'),
        startIndex: 1,
        role: 'collaborator'
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v == null) throw new Error(`Missing value for ${a}`);
            return v;
        };
        switch (a) {
            case '--help':
            case '-h':
                usage(0);
                break;
            case '--base-url':
                args.baseUrl = next().replace(/\/$/, '');
                break;
            case '--admin-user':
                args.adminUser = next();
                break;
            case '--admin-password':
                args.adminPassword = next();
                break;
            case '--project':
                args.projectId = Number(next());
                break;
            case '--count':
                args.count = Number(next());
                break;
            case '--prefix':
                args.prefix = next();
                break;
            case '--password':
                args.password = next();
                break;
            case '--out':
                args.out = path.resolve(process.cwd(), next());
                break;
            case '--start-index':
                args.startIndex = Number(next());
                break;
            case '--role':
                args.role = next();
                break;
            default:
                throw new Error(`Unknown argument: ${a}`);
        }
    }
    if (!args.baseUrl) throw new Error('--base-url is required');
    if (!args.adminUser || !args.adminPassword) {
        throw new Error('--admin-user and --admin-password are required');
    }
    if (!Number.isInteger(args.projectId) || args.projectId <= 0) {
        throw new Error('--project <id> is required');
    }
    if (!Number.isInteger(args.count) || args.count < 1) {
        throw new Error('--count must be >= 1');
    }
    if (args.password.length < 8) {
        throw new Error('--password must be at least 8 characters');
    }
    if (!['collaborator', 'observer', 'admin'].includes(args.role)) {
        throw new Error('--role must be collaborator|observer|admin');
    }
    return args;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractToken(res) {
    const raw = res.headers.getSetCookie?.() || [];
    const cookies = raw.length
        ? raw
        : String(res.headers.get('set-cookie') || '').split(/,(?=\s*[^;]+=)/);
    for (const line of cookies) {
        const m = String(line).match(/(?:^|,\s*)token=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
    }
    return null;
}

async function api(baseUrl, token, method, apiPath, body) {
    const headers = { Accept: 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers.Cookie = `token=${token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${apiPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    if (!res.ok) {
        const msg = json?.error?.message || json?.message || text || res.statusText;
        const err = new Error(`${method} ${apiPath} → ${res.status}: ${msg}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return { json, res };
}

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    if (!res.ok) {
        const err = new Error(json?.error?.message || text || `login ${res.status}`);
        err.status = res.status;
        throw err;
    }
    const token = extractToken(res);
    if (!token) throw new Error(`Login for ${username} returned no token cookie`);
    return { token, user: json.user };
}

async function registerOrLogin(baseUrl, username, email, password) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ username, email, password })
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }

    if (res.ok) {
        const token = extractToken(res);
        return {
            created: true,
            token,
            user: json.user
        };
    }

    const msg = json?.error?.message || text || res.statusText;
    if (res.status === 400 && /disabled/i.test(msg)) {
        throw new Error(
            'Registration is disabled (REGISTRATION_ENABLED=false). '
            + 'Temporarily set REGISTRATION_ENABLED=true in .env, recreate backend, re-run, then turn it off.'
        );
    }

    // Already exists — try login with the loadtest password.
    try {
        const existing = await login(baseUrl, username, password);
        return { created: false, token: existing.token, user: existing.user };
    } catch {
        throw new Error(
            `Could not create or login as ${username}: ${msg}. `
            + 'If the user exists with a different password, delete it or change --password/--prefix.'
        );
    }
}

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        usage(1);
    }

    console.log(`Provisioning ${args.count} accounts on ${args.baseUrl} for project ${args.projectId}`);

    const admin = await login(args.baseUrl, args.adminUser, args.adminPassword);
    console.log(`Admin OK: ${admin.user.username} (id=${admin.user.id})`);

    const { json: projectDetail } = await api(
        args.baseUrl,
        admin.token,
        'GET',
        `/api/projects/${args.projectId}`
    );
    const existing = Array.isArray(projectDetail.collaborators)
        ? projectDetail.collaborators.map((c) => ({
            userId: Number(c.userId ?? c.user?.id ?? c.id),
            role: c.role
        }))
        : [];

    const accounts = [];
    const newCollabIds = [];

    for (let i = 0; i < args.count; i += 1) {
        const n = args.startIndex + i;
        const username = `${args.prefix}${n}`;
        const email = `${username}@loadtest.local`;
        // Stay under register rate limit (10/min).
        if (i > 0) await sleep(7000);

        const result = await registerOrLogin(args.baseUrl, username, email, args.password);
        const userId = Number(result.user.id);
        console.log(
            `  ${result.created ? 'created' : 'exists '} ${username} id=${userId}`
        );
        accounts.push({ username, password: args.password, userId });
        newCollabIds.push(userId);
    }

    const byId = new Map();
    for (const row of existing) {
        if (Number.isInteger(row.userId) && row.userId > 0) {
            byId.set(row.userId, { userId: row.userId, role: row.role });
        }
    }
    // Keep admin as admin.
    byId.set(Number(admin.user.id), { userId: Number(admin.user.id), role: 'admin' });
    for (const userId of newCollabIds) {
        if (userId === Number(admin.user.id)) continue;
        const prev = byId.get(userId);
        byId.set(userId, {
            userId,
            role: prev?.role === 'admin' ? 'admin' : args.role
        });
    }

    const collaborators = [...byId.values()];
    await api(
        args.baseUrl,
        admin.token,
        'PUT',
        `/api/projects/${args.projectId}/collaborators`,
        { collaborators }
    );
    console.log(`Project ${args.projectId} collaborators updated (${collaborators.length} total)`);

    const outPayload = accounts.map(({ username, password }) => ({ username, password }));
    fs.writeFileSync(args.out, `${JSON.stringify(outPayload, null, 2)}\n`);
    console.log(`Wrote ${args.out}`);
    console.log(`
Next:
  node tests/full-slicer/full-slicer-load.mjs \\
    --base-url ${args.baseUrl} \\
    --project ${args.projectId} \\
    --file-name "YOUR.mrb" \\
    --accounts-file ${path.relative(process.cwd(), args.out) || args.out} \\
    --mode capacity --concurrency auto --max-concurrency ${args.count}
`);
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
