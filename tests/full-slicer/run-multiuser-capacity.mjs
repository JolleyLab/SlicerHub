#!/usr/bin/env node
/**
 * One-shot multi-user Full Slicer capacity run:
 *   1) create loadtestN accounts
 *   2) add them to a project
 *   3) auto-ramp capacity
 *   4) delete the fake users (and their seats)
 *
 * Requires REGISTRATION_ENABLED=true while creating accounts.
 *
 * Example:
 *   node tests/full-slicer/run-multiuser-capacity.mjs \
 *     --base-url http://localhost:8000 \
 *     --admin-user test --admin-password '12345678' \
 *     --project 2 --file-name 'rHiseySlicerScene.mrb' \
 *     --users 6
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOAD_SCRIPT = path.join(__dirname, 'full-slicer-load.mjs');

function usage(code = 0) {
    console.log(`
Usage: node tests/full-slicer/run-multiuser-capacity.mjs [options]

Required:
  --base-url <url>
  --admin-user <name> --admin-password <pw>
  --project <id>
  --file-id <id> | --file-name <name>

Accounts:
  --users <n>                 How many loadtest users to create (default 4)
  --prefix <name>             Username prefix (default loadtest)
  --loadtest-password <pw>    Password for fake users (default LoadTest!234)
  --keep-users                Do not delete fake users after the run
  --no-provision              Skip create; use existing --accounts-file / prefix users

Capacity (passed through):
  --hold-seconds <n>          default 60
  --max-concurrency <n>       default = --users
  --latency-factor <n>
  --gpu-mem-limit <n>
  --simplified
  --skip-metrics
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
        fileId: null,
        fileName: '',
        users: 4,
        prefix: 'loadtest',
        loadtestPassword: 'LoadTest!234',
        keepUsers: false,
        noProvision: false,
        holdSeconds: 60,
        maxConcurrency: null,
        latencyFactor: null,
        gpuMemLimit: null,
        simplified: false,
        skipMetrics: false
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
            case '--file-id':
                args.fileId = Number(next());
                break;
            case '--file-name':
                args.fileName = next();
                break;
            case '--users':
                args.users = Number(next());
                break;
            case '--prefix':
                args.prefix = next();
                break;
            case '--loadtest-password':
                args.loadtestPassword = next();
                break;
            case '--keep-users':
                args.keepUsers = true;
                break;
            case '--no-provision':
                args.noProvision = true;
                break;
            case '--hold-seconds':
                args.holdSeconds = Number(next());
                break;
            case '--max-concurrency':
                args.maxConcurrency = Number(next());
                break;
            case '--latency-factor':
                args.latencyFactor = Number(next());
                break;
            case '--gpu-mem-limit':
                args.gpuMemLimit = Number(next());
                break;
            case '--simplified':
                args.simplified = true;
                break;
            case '--skip-metrics':
                args.skipMetrics = true;
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
        throw new Error('--project is required');
    }
    if (!args.fileId && !args.fileName) {
        throw new Error('--file-id or --file-name is required');
    }
    if (!Number.isInteger(args.users) || args.users < 1) {
        throw new Error('--users must be >= 1');
    }
    if (args.loadtestPassword.length < 8) {
        throw new Error('--loadtest-password must be at least 8 characters');
    }
    if (args.maxConcurrency == null) args.maxConcurrency = args.users;
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
        throw err;
    }
    return json;
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
        throw new Error(json?.error?.message || text || `login failed (${res.status})`);
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
        return { created: true, user: json.user };
    }
    const msg = json?.error?.message || text || res.statusText;
    if (res.status === 400 && /disabled/i.test(msg)) {
        throw new Error(
            'Registration is disabled (REGISTRATION_ENABLED=false). '
            + 'Set REGISTRATION_ENABLED=true, recreate backend, re-run, then turn it off.'
        );
    }
    try {
        const existing = await login(baseUrl, username, password);
        return { created: false, user: existing.user };
    } catch {
        throw new Error(`Could not create/login ${username}: ${msg}`);
    }
}

async function provisionAccounts(args, admin) {
    const projectDetail = await api(
        args.baseUrl,
        admin.token,
        'GET',
        `/api/projects/${args.projectId}`
    );
    const existingCollabs = Array.isArray(projectDetail.collaborators)
        ? projectDetail.collaborators.map((c) => ({
            userId: Number(c.userId ?? c.user?.id ?? c.id),
            role: c.role
        }))
        : [];

    const accounts = [];
    for (let i = 0; i < args.users; i += 1) {
        const username = `${args.prefix}${i + 1}`;
        const email = `${username}@loadtest.local`;
        if (i > 0) await sleep(7000);
        const result = await registerOrLogin(
            args.baseUrl,
            username,
            email,
            args.loadtestPassword
        );
        console.log(`  ${result.created ? 'created' : 'exists '} ${username} id=${result.user.id}`);
        accounts.push({
            username,
            password: args.loadtestPassword,
            userId: Number(result.user.id)
        });
    }

    const byId = new Map();
    for (const row of existingCollabs) {
        if (Number.isInteger(row.userId) && row.userId > 0) {
            byId.set(row.userId, { userId: row.userId, role: row.role });
        }
    }
    byId.set(Number(admin.user.id), { userId: Number(admin.user.id), role: 'admin' });
    for (const account of accounts) {
        if (account.userId === Number(admin.user.id)) continue;
        const prev = byId.get(account.userId);
        byId.set(account.userId, {
            userId: account.userId,
            role: prev?.role === 'admin' ? 'admin' : 'collaborator'
        });
    }

    await api(
        args.baseUrl,
        admin.token,
        'PUT',
        `/api/projects/${args.projectId}/collaborators`,
        { collaborators: [...byId.values()] }
    );

    return {
        accounts,
        priorCollaborators: existingCollabs
    };
}

async function restoreCollaborators(args, admin, priorCollaborators) {
    const byId = new Map();
    for (const row of priorCollaborators) {
        if (Number.isInteger(row.userId) && row.userId > 0) {
            byId.set(row.userId, { userId: row.userId, role: row.role });
        }
    }
    byId.set(Number(admin.user.id), { userId: Number(admin.user.id), role: 'admin' });
    if (byId.size === 0) return;
    await api(
        args.baseUrl,
        admin.token,
        'PUT',
        `/api/projects/${args.projectId}/collaborators`,
        { collaborators: [...byId.values()] }
    );
}

async function deleteLoadtestUsers(args, admin, accounts) {
    for (const account of accounts) {
        try {
            await api(
                args.baseUrl,
                admin.token,
                'DELETE',
                `/api/users/${account.userId}`
            );
            console.log(`  deleted ${account.username} (id=${account.userId})`);
        } catch (err) {
            console.warn(`  cleanup failed for ${account.username}: ${err.message}`);
        }
    }
}

function runCapacityChild(args, accountsFile) {
    const childArgs = [
        LOAD_SCRIPT,
        '--base-url', args.baseUrl,
        '--project', String(args.projectId),
        '--accounts-file', accountsFile,
        '--mode', 'capacity',
        '--concurrency', 'auto',
        '--max-concurrency', String(args.maxConcurrency),
        '--hold-seconds', String(args.holdSeconds)
    ];
    if (args.fileId) childArgs.push('--file-id', String(args.fileId));
    if (args.fileName) childArgs.push('--file-name', args.fileName);
    if (args.latencyFactor != null) {
        childArgs.push('--latency-factor', String(args.latencyFactor));
    }
    if (args.gpuMemLimit != null) {
        childArgs.push('--gpu-mem-limit', String(args.gpuMemLimit));
    }
    if (args.simplified) childArgs.push('--simplified');
    if (args.skipMetrics) childArgs.push('--skip-metrics');

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, childArgs, {
            cwd: process.cwd(),
            stdio: 'inherit',
            windowsHide: true
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Capacity harness exited with code ${code}`));
        });
    });
}

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        usage(1);
    }

    console.log('=== multi-user Full Slicer capacity ===');
    const admin = await login(args.baseUrl, args.adminUser, args.adminPassword);
    console.log(`Admin: ${admin.user.username} (id=${admin.user.id})`);

    let accounts = [];
    let priorCollaborators = [];
    const accountsFile = path.join(__dirname, `accounts.auto-${Date.now()}.json`);

    try {
        if (!args.noProvision) {
            console.log(`\nProvisioning ${args.users} accounts (prefix=${args.prefix})…`);
            const provisioned = await provisionAccounts(args, admin);
            accounts = provisioned.accounts;
            priorCollaborators = provisioned.priorCollaborators;
        } else {
            for (let i = 0; i < args.users; i += 1) {
                const username = `${args.prefix}${i + 1}`;
                const existing = await login(args.baseUrl, username, args.loadtestPassword);
                accounts.push({
                    username,
                    password: args.loadtestPassword,
                    userId: Number(existing.user.id)
                });
            }
            const projectDetail = await api(
                args.baseUrl,
                admin.token,
                'GET',
                `/api/projects/${args.projectId}`
            );
            priorCollaborators = Array.isArray(projectDetail.collaborators)
                ? projectDetail.collaborators.map((c) => ({
                    userId: Number(c.userId ?? c.user?.id ?? c.id),
                    role: c.role
                }))
                : [];
        }

        fs.writeFileSync(
            accountsFile,
            `${JSON.stringify(accounts.map(({ username, password }) => ({ username, password })), null, 2)}\n`
        );

        console.log('\nRunning capacity auto-ramp…');
        await runCapacityChild(args, accountsFile);
    } finally {
        try {
            fs.unlinkSync(accountsFile);
        } catch {
            /* ignore */
        }

        if (!args.keepUsers && accounts.length) {
            console.log('\nCleaning up load-test users…');
            try {
                await restoreCollaborators(args, admin, priorCollaborators);
            } catch (err) {
                console.warn(`  restore collaborators: ${err.message}`);
            }
            // Re-login in case long run expired the admin session.
            let cleanupAdmin = admin;
            try {
                cleanupAdmin = await login(args.baseUrl, args.adminUser, args.adminPassword);
            } catch {
                /* use prior token */
            }
            await deleteLoadtestUsers(args, cleanupAdmin, accounts);
            console.log('Cleanup done.');
        } else if (args.keepUsers) {
            console.log('\nKeeping load-test users (--keep-users).');
        }
    }
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
