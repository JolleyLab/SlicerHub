#!/usr/bin/env node
/**
 * Local Full Slicer capacity + robustness harness (My Projects / Local GPU only).
 *
 * Does NOT cover Trame or Vast. Talks to the same APIs the My Projects UI uses:
 *   prepare / open / busy-status / heartbeat / stop
 *
 * Auto capacity (finds max concurrent seats without a manual range):
 *   node tests/full-slicer/full-slicer-load.mjs \
 *     --base-url http://localhost:8000 \
 *     --project 1 --file-name "Scene.mrb" \
 *     --user alice --password secret \
 *     --mode capacity --concurrency auto
 *
 * Optional: --max-concurrency 8 --latency-factor 2.5 --gpu-mem-limit 90
 *
 * Multi-user capacity (provision + auto-ramp + delete fake users):
 *   node tests/full-slicer/run-multiuser-capacity.mjs \
 *     --base-url http://localhost:8000 \
 *     --admin-user test --admin-password '...' \
 *     --project 2 --file-name "Scene.mrb" --users 6
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage(exitCode = 0) {
    const text = `
Usage: node tests/full-slicer/full-slicer-load.mjs [options]

Required:
  --base-url <url>          App origin (e.g. http://localhost:8000)
  --project <id>            My Projects project id
  --file-id <id> | --file-name <name>
  --user <name> --password <pw>   OR  --accounts-file <json>

Modes:
  --mode capacity           Ramp concurrency (default)
  --mode soak               Hold N sessions for --duration
  --mode robustness         Open/stop, warm reopen, seat-kick checks

Capacity / soak:
  --concurrency <n|a-b|auto>  Fixed N, ramp a..b, or auto-find max (default: auto)
  --max-concurrency <n>       Ceiling for auto ramp (default 8)
  --latency-factor <n>         Fail if ready p95 > baseline×factor (default 2.5)
  --gpu-mem-limit <n>         Fail if GPU mem % ≥ limit (default 90)
  --hold-seconds <n>          Hold each capacity step (default 90)
  --duration <30s|10m|1h>     Soak length (default 15m)
  --step-cooldown <n>         Seconds between capacity steps (default 20)

Robustness:
  --cycles <n>              Repeat count (default 3)

Common:
  --simplified              Open with useSimplifiedViewer=true
  --heartbeat-ms <n>        Heartbeat interval (default 20000)
  --ready-timeout-ms <n>    Wait for busy→idle after open (default 300000)
  --out <dir>               Results directory (default ./tests/full-slicer/results/<ts>)
  --skip-metrics            Do not sample nvidia-smi / docker stats
  --no-cleanup              Leave seats running on exit (debug)
  --help
`.trim();
    console.log(text);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const args = {
        baseUrl: '',
        projectId: null,
        fileId: null,
        fileName: '',
        user: '',
        password: '',
        accountsFile: '',
        mode: 'capacity',
        concurrency: 'auto',
        maxConcurrency: 8,
        latencyFactor: 2.5,
        gpuMemLimit: 90,
        holdSeconds: 90,
        durationMs: 15 * 60 * 1000,
        stepCooldown: 20,
        cycles: 3,
        simplified: false,
        heartbeatMs: 20_000,
        readyTimeoutMs: 300_000,
        out: '',
        skipMetrics: false,
        noCleanup: false
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
            case '--project':
                args.projectId = Number(next());
                break;
            case '--file-id':
                args.fileId = Number(next());
                break;
            case '--file-name':
                args.fileName = next();
                break;
            case '--user':
                args.user = next();
                break;
            case '--password':
                args.password = next();
                break;
            case '--accounts-file':
                args.accountsFile = next();
                break;
            case '--mode':
                args.mode = next();
                break;
            case '--concurrency':
                args.concurrency = next();
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
            case '--hold-seconds':
                args.holdSeconds = Number(next());
                break;
            case '--duration':
                args.durationMs = parseDuration(next());
                break;
            case '--step-cooldown':
                args.stepCooldown = Number(next());
                break;
            case '--cycles':
                args.cycles = Number(next());
                break;
            case '--simplified':
                args.simplified = true;
                break;
            case '--heartbeat-ms':
                args.heartbeatMs = Number(next());
                break;
            case '--ready-timeout-ms':
                args.readyTimeoutMs = Number(next());
                break;
            case '--out':
                args.out = next();
                break;
            case '--skip-metrics':
                args.skipMetrics = true;
                break;
            case '--no-cleanup':
                args.noCleanup = true;
                break;
            default:
                throw new Error(`Unknown argument: ${a}`);
        }
    }

    if (!args.baseUrl) throw new Error('--base-url is required');
    if (!Number.isInteger(args.projectId) || args.projectId <= 0) {
        throw new Error('--project <id> is required');
    }
    if (!['capacity', 'soak', 'robustness'].includes(args.mode)) {
        throw new Error('--mode must be capacity|soak|robustness');
    }
    if (!Number.isFinite(args.maxConcurrency) || args.maxConcurrency < 1) {
        throw new Error('--max-concurrency must be >= 1');
    }
    if (!Number.isFinite(args.latencyFactor) || args.latencyFactor < 1) {
        throw new Error('--latency-factor must be >= 1');
    }
    if (!Number.isFinite(args.gpuMemLimit) || args.gpuMemLimit <= 0) {
        throw new Error('--gpu-mem-limit must be > 0');
    }
    return args;
}

function parseDuration(raw) {
    const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
    if (!m) throw new Error(`Invalid duration: ${raw}`);
    const n = Number(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    if (unit === 'ms') return Math.round(n);
    if (unit === 's') return Math.round(n * 1000);
    if (unit === 'm') return Math.round(n * 60_000);
    return Math.round(n * 3_600_000);
}

function parseConcurrency(raw, maxConcurrency) {
    const s = String(raw).trim().toLowerCase();
    if (s === 'auto') {
        return { auto: true, from: 1, to: maxConcurrency };
    }
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        return { auto: false, from: n, to: n };
    }
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) throw new Error(`Invalid --concurrency: ${raw} (use N, A-B, or auto)`);
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from < 1 || to < from) throw new Error(`Invalid --concurrency range: ${raw}`);
    return { auto: false, from, to };
}

function stepGateFailures(step, { latencyFactor = 2.5, gpuMemLimit = 90 } = {}) {
    const failures = [];
    if ((step.errors || 0) > 0) failures.push(`open_errors=${step.errors}`);
    if ((step.heartbeatFailures || 0) > 0) {
        failures.push(`heartbeat_failures=${step.heartbeatFailures}`);
    }
    if (step.gpuMemPctMax != null && step.gpuMemPctMax >= gpuMemLimit) {
        failures.push(`gpu_mem=${step.gpuMemPctMax}%>=${gpuMemLimit}%`);
    }
    if (
        step.openReadyP95Ms != null
        && step.baselineReadyMs != null
        && step.openReadyP95Ms > step.baselineReadyMs * latencyFactor
    ) {
        failures.push(
            `ready_p95=${step.openReadyP95Ms}ms > baseline ${step.baselineReadyMs}ms × ${latencyFactor}`
        );
    }
    return failures;
}

function stepPassesGates(step, gates) {
    return stepGateFailures(step, gates).length === 0;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
    return new Date().toISOString();
}

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

function loadAccounts(args) {
    if (args.accountsFile) {
        const abs = path.isAbsolute(args.accountsFile)
            ? args.accountsFile
            : path.resolve(process.cwd(), args.accountsFile);
        const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const list = Array.isArray(raw) ? raw : raw.accounts;
        if (!Array.isArray(list) || !list.length) {
            throw new Error('accounts file must be [{username,password}, ...]');
        }
        return list.map((row, i) => {
            const username = String(row.username || row.user || '').trim();
            const password = String(row.password || row.pass || '');
            if (!username || !password) {
                throw new Error(`accounts[${i}] needs username and password`);
            }
            return { username, password };
        });
    }
    if (!args.user || !args.password) {
        throw new Error('Provide --user/--password or --accounts-file');
    }
    return [{ username: args.user, password: args.password }];
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
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
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
        throw new Error(`Login failed for ${username}: ${json?.error?.message || text || res.status}`);
    }
    const token = extractToken(res);
    if (!token) {
        throw new Error(`Login for ${username} succeeded but no token cookie was returned`);
    }
    return { token, user: json?.user || { username } };
}

function runCapture(command, args, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve({ ok: false, stdout, stderr: stderr || 'timeout' });
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ ok: false, stdout, stderr: err.message });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, stdout, stderr });
        });
    });
}

async function sampleMetrics() {
    const sample = { at: nowIso(), gpu: null, containers: [] };

    const smi = await runCapture('nvidia-smi', [
        '--query-gpu=index,name,utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits'
    ]);
    if (smi.ok) {
        sample.gpu = smi.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
            const [index, name, util, memUsed, memTotal] = line.split(',').map((s) => s.trim());
            const used = Number(memUsed);
            const total = Number(memTotal);
            return {
                index: Number(index),
                name,
                utilPct: Number(util),
                memUsedMiB: used,
                memTotalMiB: total,
                memPct: total > 0 ? Math.round((used / total) * 1000) / 10 : null
            };
        });
    } else {
        sample.gpuError = smi.stderr.trim() || 'nvidia-smi unavailable';
    }

    const stats = await runCapture('docker', [
        'stats',
        '--no-stream',
        '--format',
        '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
    ]);
    if (stats.ok) {
        sample.containers = stats.stdout.trim().split(/\r?\n/).filter(Boolean)
            .map((line) => {
                const [name, cpu, memUsage, memPerc] = line.split('\t');
                return { name, cpu, memUsage, memPerc };
            })
            .filter((row) => /^slicer-gui-/i.test(row.name || ''));
    } else {
        sample.dockerError = stats.stderr.trim() || 'docker stats unavailable';
    }

    return sample;
}

class ResultSink {
    constructor(outDir) {
        this.outDir = outDir;
        fs.mkdirSync(outDir, { recursive: true });
        this.eventsPath = path.join(outDir, 'events.jsonl');
        this.metricsPath = path.join(outDir, 'metrics.csv');
        this.summaryPath = path.join(outDir, 'summary.json');
        fs.writeFileSync(
            this.metricsPath,
            'at,gpu_util_pct,gpu_mem_used_mib,gpu_mem_total_mib,gpu_mem_pct,slicer_containers,notes\n'
        );
        this.steps = [];
        this.events = [];
    }

    event(type, data = {}) {
        const row = { at: nowIso(), type, ...data };
        this.events.push(row);
        fs.appendFileSync(this.eventsPath, `${JSON.stringify(row)}\n`);
        return row;
    }

    writeMetric(sample, notes = '') {
        const gpu = sample.gpu?.[0];
        const line = [
            sample.at,
            gpu?.utilPct ?? '',
            gpu?.memUsedMiB ?? '',
            gpu?.memTotalMiB ?? '',
            gpu?.memPct ?? '',
            sample.containers?.length ?? '',
            JSON.stringify(notes)
        ].join(',');
        fs.appendFileSync(this.metricsPath, `${line}\n`);
    }

    addStep(step) {
        this.steps.push(step);
    }

    finalize(extra = {}) {
        const gates = extra.gates || {};
        const summary = {
            finishedAt: nowIso(),
            steps: this.steps,
            suggestedMaxConcurrency: suggestMax(this.steps, gates),
            ...extra
        };
        fs.writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
        return summary;
    }
}

function suggestMax(steps, gates = {}) {
    const capacity = steps.filter((s) => s.kind === 'capacity');
    if (!capacity.length) return null;
    let best = 0;
    for (const step of capacity) {
        if (stepPassesGates(step, gates)) best = step.concurrency;
        else break;
    }
    return best || null;
}

class SessionClient {
    constructor({ baseUrl, account, projectId, fileId, simplified, heartbeatMs, readyTimeoutMs, sink }) {
        this.baseUrl = baseUrl;
        this.account = account;
        this.projectId = projectId;
        this.fileId = fileId;
        this.simplified = simplified;
        this.heartbeatMs = heartbeatMs;
        this.readyTimeoutMs = readyTimeoutMs;
        this.sink = sink;
        this.token = null;
        this.sessionToken = null;
        this.seatId = null;
        this.containerName = null;
        this.heartbeatTimer = null;
        this.heartbeatFailures = 0;
        this.openMs = null;
        this.readyMs = null;
        this.sessionReused = null;
        this.sceneReloaded = null;
    }

    async ensureLogin() {
        if (this.token) return;
        const { token, user } = await login(this.baseUrl, this.account.username, this.account.password);
        this.token = token;
        this.userId = user?.id;
        this.sink.event('login', { username: this.account.username, userId: this.userId });
    }

    async resolveFileId(fileName) {
        await this.ensureLogin();
        const data = await api(this.baseUrl, this.token, 'GET', `/api/projects/${this.projectId}/files`);
        const files = data.files || [];
        const want = fileName.toLowerCase();
        const match = files.find((f) => String(f.originalName || '').toLowerCase() === want)
            || files.find((f) => String(f.originalName || '').toLowerCase().includes(want))
            || files.find((f) => String(f.displayTitle || '').toLowerCase().includes(want));
        if (!match) {
            const names = files.map((f) => f.originalName).slice(0, 12).join(', ');
            throw new Error(`File not found for --file-name "${fileName}". Examples: ${names || '(none)'}`);
        }
        return match.id;
    }

    async assertLocalGpu() {
        await this.ensureLogin();
        const data = await api(this.baseUrl, this.token, 'GET', `/api/projects/${this.projectId}/gpu`);
        const providerId = data?.settings?.providerId || data?.instance?.providerId;
        if (providerId && providerId !== 'local') {
            throw new Error(
                `Project ${this.projectId} provider is "${providerId}". `
                + 'This harness only supports Local GPU Full Slicer.'
            );
        }
    }

    async prepare() {
        await this.ensureLogin();
        const t0 = Date.now();
        const data = await api(
            this.baseUrl,
            this.token,
            'POST',
            `/api/projects/${this.projectId}/gpu/prepare-full-slicer`,
            { useSimplifiedViewer: this.simplified }
        );
        this.sink.event('prepare', {
            username: this.account.username,
            ms: Date.now() - t0,
            seatId: data.seatId,
            sessionReused: data.sessionReused
        });
        return data;
    }

    async open() {
        await this.ensureLogin();
        const t0 = Date.now();
        const data = await api(
            this.baseUrl,
            this.token,
            'POST',
            `/api/projects/${this.projectId}/gpu/open-full-slicer`,
            {
                fileId: this.fileId,
                useSimplifiedViewer: this.simplified
            }
        );
        this.openMs = Date.now() - t0;
        this.sessionToken = data.sessionToken;
        this.seatId = data.seatId;
        this.containerName = data.sessionId;
        this.sessionReused = data.sessionReused === true;
        this.sceneReloaded = data.sceneReloaded !== false;
        this.sink.event('open', {
            username: this.account.username,
            openMs: this.openMs,
            seatId: this.seatId,
            sessionReused: this.sessionReused,
            sceneReloaded: this.sceneReloaded,
            containerName: this.containerName
        });

        const readyStart = Date.now();
        await this.waitUntilIdle();
        this.readyMs = Date.now() - readyStart;
        this.sink.event('ready', {
            username: this.account.username,
            seatId: this.seatId,
            readyMs: this.readyMs,
            totalMs: this.openMs + this.readyMs
        });
        this.startHeartbeat();
        return data;
    }

    async waitUntilIdle() {
        const deadline = Date.now() + this.readyTimeoutMs;
        let last = null;
        while (Date.now() < deadline) {
            last = await api(
                this.baseUrl,
                this.token,
                'GET',
                `/api/projects/${this.projectId}/gpu/full-slicer-status?seatId=${this.seatId || 1}`
            );
            if (!last.busy) return last;
            await sleep(1500);
        }
        throw new Error(
            `Timed out waiting for seat ${this.seatId} idle `
            + `(last message=${last?.message || 'unknown'})`
        );
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.heartbeat().catch((err) => {
                this.heartbeatFailures += 1;
                this.sink.event('heartbeat_error', {
                    username: this.account.username,
                    seatId: this.seatId,
                    message: err.message,
                    status: err.status || null
                });
            });
        }, this.heartbeatMs);
        if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    async heartbeat() {
        if (!this.sessionToken) return null;
        return api(
            this.baseUrl,
            this.token,
            'POST',
            `/api/projects/${this.projectId}/gpu/full-slicer-heartbeat`,
            { sessionToken: this.sessionToken }
        );
    }

    async stop(mode = 'hard') {
        this.stopHeartbeat();
        if (!this.sessionToken) return null;
        try {
            const data = await api(
                this.baseUrl,
                this.token,
                'POST',
                `/api/projects/${this.projectId}/gpu/stop-full-slicer`,
                { sessionToken: this.sessionToken, mode }
            );
            this.sink.event('stop', {
                username: this.account.username,
                seatId: this.seatId,
                mode
            });
            this.sessionToken = null;
            return data;
        } catch (err) {
            this.sink.event('stop_error', {
                username: this.account.username,
                seatId: this.seatId,
                message: err.message
            });
            this.sessionToken = null;
            return null;
        }
    }
}

async function startMetricsLoop(sink, { enabled, intervalMs = 5000 }) {
    if (!enabled) {
        return { stop: async () => {}, peaks: () => ({}) };
    }
    let stopped = false;
    let peakMem = null;
    let peakUtil = null;
    const tick = async () => {
        try {
            const sample = await sampleMetrics();
            sink.writeMetric(sample);
            const gpu = sample.gpu?.[0];
            if (gpu?.memPct != null) peakMem = Math.max(peakMem ?? 0, gpu.memPct);
            if (gpu?.utilPct != null) peakUtil = Math.max(peakUtil ?? 0, gpu.utilPct);
        } catch (err) {
            sink.event('metrics_error', { message: err.message });
        }
    };
    await tick();
    const timer = setInterval(() => {
        if (!stopped) tick();
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return {
        stop: async () => {
            stopped = true;
            clearInterval(timer);
            await tick();
        },
        peaks: () => ({ gpuMemPctMax: peakMem, gpuUtilPctMax: peakUtil })
    };
}

async function holdSessions(sessions, holdMs, sink, label) {
    sink.event('hold_start', { label, sessions: sessions.length, holdMs });
    const deadline = Date.now() + holdMs;
    while (Date.now() < deadline) {
        await sleep(Math.min(5000, Math.max(250, deadline - Date.now())));
    }
    sink.event('hold_end', { label, sessions: sessions.length });
}

function summarizeSessions(sessions, peaks, extras = {}) {
    const ready = sessions.map((s) => s.readyMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const open = sessions.map((s) => s.openMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const total = sessions
        .map((s) => (Number.isFinite(s.openMs) && Number.isFinite(s.readyMs) ? s.openMs + s.readyMs : null))
        .filter((n) => n != null)
        .sort((a, b) => a - b);
    return {
        concurrency: sessions.length,
        errors: extras.errors || 0,
        heartbeatFailures: sessions.reduce((n, s) => n + s.heartbeatFailures, 0),
        openP50Ms: percentile(open, 50),
        openP95Ms: percentile(open, 95),
        openReadyP50Ms: percentile(total, 50),
        openReadyP95Ms: percentile(total, 95),
        seats: sessions.map((s) => ({
            username: s.account.username,
            seatId: s.seatId,
            openMs: s.openMs,
            readyMs: s.readyMs,
            sessionReused: s.sessionReused,
            sceneReloaded: s.sceneReloaded,
            heartbeatFailures: s.heartbeatFailures,
            containerName: s.containerName
        })),
        ...peaks,
        ...extras
    };
}

async function stopMany(sessions, mode = 'hard') {
    await Promise.all(sessions.map((s) => s.stop(mode)));
}

const activeSessions = [];

function trackSession(session) {
    activeSessions.push(session);
    return session;
}

async function cleanupActive(mode = 'hard') {
    const list = activeSessions.splice(0, activeSessions.length);
    if (list.length) await stopMany(list, mode);
}

async function openMany({ args, accounts, fileId, sink, count }) {
    const sessions = [];
    let errors = 0;
    for (let i = 0; i < count; i += 1) {
        const account = accounts[i % accounts.length];
        const client = new SessionClient({
            baseUrl: args.baseUrl,
            account,
            projectId: args.projectId,
            fileId,
            simplified: args.simplified,
            heartbeatMs: args.heartbeatMs,
            readyTimeoutMs: args.readyTimeoutMs,
            sink
        });
        try {
            await client.open();
            trackSession(client);
            sessions.push(client);
            console.log(
                `  opened ${account.username} seat=${client.seatId} `
                + `open=${client.openMs}ms ready=${client.readyMs}ms `
                + `reused=${client.sessionReused}`
            );
        } catch (err) {
            errors += 1;
            sink.event('open_error', { username: account.username, message: err.message });
            console.error(`  OPEN FAIL ${account.username}: ${err.message}`);
            await client.stop('hard');
        }
    }
    return { sessions, errors };
}

async function runCapacity(args, accounts, fileId, sink) {
    const { auto, from, to } = parseConcurrency(args.concurrency, args.maxConcurrency);
    const gates = {
        latencyFactor: args.latencyFactor,
        gpuMemLimit: args.gpuMemLimit
    };
    let baselineReadyMs = null;
    let breakingN = null;
    let breakReasons = [];

    console.log(
        auto
            ? `\nAuto capacity ramp 1…${to} (stop on first gate failure)`
            : `\nCapacity ramp ${from}…${to}`
    );
    if (accounts.length < to) {
        console.log(
            `Note: ${accounts.length} account(s) for up to ${to} seats — `
            + 'one user reuses seats (kick at maxSeats). '
            + 'Use --accounts-file with N users for true multi-user capacity.'
        );
    }

    for (let n = from; n <= to; n += 1) {
        console.log(`\n=== capacity concurrency=${n} ===`);
        const metrics = await startMetricsLoop(sink, { enabled: !args.skipMetrics });
        const { sessions, errors } = await openMany({ args, accounts, fileId, sink, count: n });
        await holdSessions(sessions, args.holdSeconds * 1000, sink, `capacity-${n}`);
        const peaks = metrics.peaks();
        await metrics.stop();
        const step = {
            kind: 'capacity',
            ...summarizeSessions(sessions, peaks, { errors, baselineReadyMs }),
            auto
        };
        if (baselineReadyMs == null && step.openReadyP50Ms != null) {
            baselineReadyMs = step.openReadyP50Ms;
            step.baselineReadyMs = baselineReadyMs;
        } else {
            step.baselineReadyMs = baselineReadyMs;
        }
        const failures = stepGateFailures(step, gates);
        step.passed = failures.length === 0;
        step.failures = failures;
        sink.addStep(step);
        printStep(step);

        if (!args.noCleanup) {
            await stopMany(sessions, 'hard');
            activeSessions.length = 0;
        }

        if (failures.length) {
            breakingN = n;
            breakReasons = failures;
            console.log(`  GATE FAIL at concurrency=${n}: ${failures.join('; ')}`);
            if (auto) {
                console.log('  Auto ramp stopping.');
                break;
            }
        } else {
            console.log(`  GATE OK at concurrency=${n}`);
        }

        if (n < to) await sleep(args.stepCooldown * 1000);
    }

    const suggested = suggestMax(sink.steps, gates);
    sink.event('capacity_done', {
        auto,
        suggestedMaxConcurrency: suggested,
        breakingConcurrency: breakingN,
        breakReasons
    });
    console.log(
        `\nSuggested max concurrent Full Slicer seats: ${suggested ?? 'none (N=1 already failed)'}`
    );
    if (breakingN != null) {
        console.log(`First failure at concurrency=${breakingN}: ${breakReasons.join('; ')}`);
    }
    console.log('Confirm scroll/UX manually at that N before treating it as production capacity.');
}

async function runSoak(args, accounts, fileId, sink) {
    const parsed = parseConcurrency(args.concurrency, args.maxConcurrency);
    if (parsed.auto) {
        throw new Error('Soak mode needs a fixed --concurrency N (not auto)');
    }
    const n = parsed.to;
    console.log(`\n=== soak concurrency=${n} duration=${args.durationMs}ms ===`);
    const metrics = await startMetricsLoop(sink, { enabled: !args.skipMetrics, intervalMs: 10_000 });
    const { sessions, errors } = await openMany({ args, accounts, fileId, sink, count: n });
    await holdSessions(sessions, args.durationMs, sink, `soak-${n}`);
    const peaks = metrics.peaks();
    await metrics.stop();
    const step = { kind: 'soak', ...summarizeSessions(sessions, peaks, { errors }) };
    sink.addStep(step);
    printStep(step);
    if (!args.noCleanup) {
        await stopMany(sessions, 'hard');
        activeSessions.length = 0;
    }
}

async function runRobustness(args, accounts, fileId, sink) {
    const account = accounts[0];
    console.log(`\n=== robustness cycles=${args.cycles} account=${account.username} ===`);

    for (let cycle = 1; cycle <= args.cycles; cycle += 1) {
        console.log(`\n-- cycle ${cycle}/${args.cycles}: cold open/stop --`);
        const cold = new SessionClient({
            baseUrl: args.baseUrl,
            account,
            projectId: args.projectId,
            fileId,
            simplified: args.simplified,
            heartbeatMs: args.heartbeatMs,
            readyTimeoutMs: args.readyTimeoutMs,
            sink
        });
        await cold.open();
        trackSession(cold);
        await sleep(3000);
        await cold.stop('hard');
        activeSessions.length = 0;
        sink.addStep({
            kind: 'robustness-cold',
            cycle,
            openMs: cold.openMs,
            readyMs: cold.readyMs,
            heartbeatFailures: cold.heartbeatFailures
        });
    }

    console.log('\n-- warm prepare → open → soft stop → reopen --');
    const warm = new SessionClient({
        baseUrl: args.baseUrl,
        account,
        projectId: args.projectId,
        fileId,
        simplified: args.simplified,
        heartbeatMs: args.heartbeatMs,
        readyTimeoutMs: args.readyTimeoutMs,
        sink
    });
    await warm.prepare();
    await warm.open();
    trackSession(warm);
    const firstReady = warm.readyMs;
    await warm.stop('soft');
    await sleep(2000);
    await warm.open();
    trackSession(warm);
    sink.addStep({
        kind: 'robustness-warm',
        firstReadyMs: firstReady,
        reopenOpenMs: warm.openMs,
        reopenReadyMs: warm.readyMs,
        sessionReused: warm.sessionReused,
        sceneReloaded: warm.sceneReloaded,
        heartbeatFailures: warm.heartbeatFailures
    });
    console.log(
        `  warm reopen reused=${warm.sessionReused} sceneReloaded=${warm.sceneReloaded} `
        + `ready=${warm.readyMs}ms`
    );
    await warm.stop('hard');

    console.log('\n-- seat kick (open maxSeats+1 on one user) --');
    const kickSessions = [];
    let maxSeats = 2;
    try {
        for (let i = 0; i < 9; i += 1) {
            const client = new SessionClient({
                baseUrl: args.baseUrl,
                account,
                projectId: args.projectId,
                fileId,
                simplified: args.simplified,
                heartbeatMs: args.heartbeatMs,
                readyTimeoutMs: args.readyTimeoutMs,
                sink
            });
            const data = await client.open();
            maxSeats = Number(data.maxSeats) || maxSeats;
            trackSession(client);
            kickSessions.push(client);
            if (kickSessions.length > maxSeats) break;
        }
    } catch (err) {
        sink.event('kick_open_error', { message: err.message });
        console.error(`  kick open error: ${err.message}`);
    }

    await sleep(args.heartbeatMs + 2000);
    const dead = [];
    for (const s of kickSessions) {
        try {
            await s.heartbeat();
        } catch (err) {
            dead.push({ seatId: s.seatId, status: err.status || null, message: err.message });
        }
    }
    sink.addStep({
        kind: 'robustness-kick',
        maxSeats,
        opened: kickSessions.length,
        deadHeartbeats: dead
    });
    console.log(
        `  opened=${kickSessions.length} maxSeats=${maxSeats} `
        + `deadHeartbeats=${dead.length}`
    );
    if (!args.noCleanup) {
        await stopMany(kickSessions, 'hard');
        activeSessions.length = 0;
    }
}

function printStep(step) {
    if (step.kind === 'capacity' || step.kind === 'soak') {
        const gate = step.passed == null ? '' : (step.passed ? ' PASS' : ' FAIL');
        console.log(
            `  summary concurrency=${step.concurrency} errors=${step.errors} `
            + `hbFail=${step.heartbeatFailures} `
            + `readyP50=${step.openReadyP50Ms ?? '-'}ms readyP95=${step.openReadyP95Ms ?? '-'}ms `
            + `gpuMemMax=${step.gpuMemPctMax ?? '-'}%${gate}`
        );
        return;
    }
    console.log(`  summary ${JSON.stringify(step)}`);
}

async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        usage(1);
    }

    const accounts = loadAccounts(args);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = args.out
        ? path.resolve(process.cwd(), args.out)
        : path.join(__dirname, 'results', stamp);
    const sink = new ResultSink(outDir);

    console.log(`Full Slicer load harness → ${outDir}`);
    console.log(`mode=${args.mode} project=${args.projectId} accounts=${accounts.length}`);

    const probe = new SessionClient({
        baseUrl: args.baseUrl,
        account: accounts[0],
        projectId: args.projectId,
        fileId: args.fileId || 0,
        simplified: args.simplified,
        heartbeatMs: args.heartbeatMs,
        readyTimeoutMs: args.readyTimeoutMs,
        sink
    });
    await probe.assertLocalGpu();
    let fileId = args.fileId;
    if (!fileId) {
        if (!args.fileName) throw new Error('Provide --file-id or --file-name');
        fileId = await probe.resolveFileId(args.fileName);
        console.log(`resolved file "${args.fileName}" → id ${fileId}`);
    }

    sink.event('run_start', {
        mode: args.mode,
        baseUrl: args.baseUrl,
        projectId: args.projectId,
        fileId,
        accounts: accounts.map((a) => a.username),
        concurrency: args.concurrency,
        simplified: args.simplified
    });

    const trackStop = async () => {
        if (args.noCleanup) return;
        await cleanupActive('hard');
    };
    process.on('SIGINT', async () => {
        console.log('\nInterrupted — cleaning up seats…');
        await trackStop();
        process.exit(130);
    });

    try {
        if (args.mode === 'capacity') {
            await runCapacity(args, accounts, fileId, sink);
        } else if (args.mode === 'soak') {
            await runSoak(args, accounts, fileId, sink);
        } else {
            await runRobustness(args, accounts, fileId, sink);
        }
    } finally {
        await trackStop();
    }

    const summary = sink.finalize({
        mode: args.mode,
        projectId: args.projectId,
        fileId,
        baseUrl: args.baseUrl,
        accounts: accounts.map((a) => a.username),
        gates: {
            latencyFactor: args.latencyFactor,
            gpuMemLimit: args.gpuMemLimit,
            maxConcurrency: args.maxConcurrency
        }
    });

    console.log('\n=== done ===');
    console.log(`results: ${outDir}`);
    if (summary.suggestedMaxConcurrency != null) {
        console.log(
            `suggested max concurrency (auto gate): ${summary.suggestedMaxConcurrency}`
        );
        console.log('Confirm scroll/UX manually at that N before treating it as production capacity.');
    }
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
