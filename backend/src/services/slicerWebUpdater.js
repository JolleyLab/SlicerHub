/**
 * SlicerWeb channel updater.
 *
 * Two channels: 'stable' and 'latest'.
 * - stable: background poller checks every N hours and updates automatically.
 * - latest: peek fires on page load; if a new build is found the clone runs in the background.
 *   Webhook (POST /api/slicerweb/webhook) triggers the same path immediately on push.
 *
 * shouldApplyUpdate is the future OrgAdmin approval gate — today it always returns true.
 */

import { readFile, writeFile, mkdir, rm, access, readdir, cp } from 'fs/promises';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import path from 'path';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

const CHANNELS = ['stable', 'latest'];
const CHANNEL_REFS = { stable: 'deploy/stable', latest: 'deploy/latest' };

const _inFlight = new Map(); // serialises concurrent updates per channel
const _progress = new Map(); // live download progress per channel; cleared when idle

export function getUpdateProgress(channel) {
    return _progress.get(channel) ?? { phase: 'idle', percent: 0, message: '' };
}

function channelDir(channel) {
    return channel === 'stable'
        ? config.slicerWeb.stableDir
        : config.slicerWeb.latestDir;
}

async function getGitHubToken() {
    const { app, githubToken } = config.slicerWeb;
    if (app.id && app.installationId && app.privateKey) {
        const now = Math.floor(Date.now() / 1000);
        const appJwt = jwt.sign(
            { iat: now - 60, exp: now + 540, iss: app.id },
            app.privateKey,
            { algorithm: 'RS256' }
        );
        const res = await fetch(
            `https://api.github.com/app/installations/${app.installationId}/access_tokens`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${appJwt}`,
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'slicerweb-updater',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );
        if (!res.ok) throw new Error(`GitHub App token exchange failed: ${res.status}`);
        const data = await res.json();
        return data.token;
    }
    if (githubToken) return githubToken;
    throw new Error('No GitHub credentials configured (see SLICERWEB_GITHUB_APP_* or SLICERWEB_GITHUB_TOKEN)');
}

async function githubHeaders() {
    const token = await getGitHubToken();
    return { Authorization: `Bearer ${token}`, 'User-Agent': 'slicerweb-updater', 'X-GitHub-Api-Version': '2022-11-28' };
}

async function getInstalledSha(channel) {
    try {
        const versionFile = path.join(channelDir(channel), '.version');
        return (await readFile(versionFile, 'utf8')).trim();
    } catch {
        return null;
    }
}

async function fetchLatestSha(channel) {
    const { owner, repo } = config.slicerWeb;
    const ref = CHANNEL_REFS[channel];
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=1`;
    const res = await fetch(url, { headers: await githubHeaders() });
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching SHA for ${channel}`);
    const [commit] = await res.json();
    if (!commit?.sha) throw new Error(`No commit found on ${ref}`);
    return commit.sha;
}

// Future OrgAdmin approval gate — returns false to hold an update for admin review.
// eslint-disable-next-line no-unused-vars
async function shouldApplyUpdate(_channel, _newSha) {
    return true;
}

async function downloadAndInstall(channel, sha) {
    const { owner, repo } = config.slicerWeb;
    const ref = CHANNEL_REFS[channel];
    const dest = channelDir(channel);
    const tmp = dest + '._installing';

    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });

    try {
        const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
        const res = await fetch(tarballUrl, {
            headers: { ...(await githubHeaders()), Accept: 'application/vnd.github+json' },
            redirect: 'follow'
        });
        if (!res.ok) throw new Error(`Tarball download failed: ${res.status}`);

        await new Promise((resolve, reject) => {
            const tar = spawn('tar', ['xz', '--strip-components=1', '-C', tmp], {
                stdio: ['pipe', 'ignore', 'pipe']
            });
            let stderr = '';
            tar.stderr.on('data', (d) => { stderr += d; });
            tar.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar failed (${code}): ${stderr}`)));
            tar.on('error', reject);
            Readable.fromWeb(res.body).pipe(tar.stdin);
        });

        await writeFile(path.join(tmp, '.version'), sha, 'utf8');
        await swapIntoPlace(tmp, dest);

        console.log(`[SlicerWebUpdater] ${channel} updated to ${sha.slice(0, 12)}`);
    } catch (err) {
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
        throw err;
    }
}

// cp instead of rename: rename fails with EBUSY (bind-mount) or EXDEV (cross-device)
async function swapIntoPlace(tmp, dest) {
    await mkdir(dest, { recursive: true });
    const existing = await readdir(dest).catch(() => []);
    await Promise.all(existing.map(e => rm(path.join(dest, e), { recursive: true, force: true })));
    await cp(tmp, dest, { recursive: true });
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function getDeployKeyPath() {
    const p = config.slicerWeb.deployKeyPath;
    if (!p) return null;
    try { await access(p); return p; } catch { return null; }
}

function sshEnv(deployKeyPath) {
    return {
        ...process.env,
        GIT_SSH_COMMAND: `ssh -i "${deployKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
        GIT_TERMINAL_PROMPT: '0'
    };
}

function sshRepoUrl() {
    return `git@github.com:${config.slicerWeb.owner}/${config.slicerWeb.repo}.git`;
}

async function fetchLatestShaViaGit(channel, deployKeyPath) {
    const ref = `refs/heads/${CHANNEL_REFS[channel]}`;
    return new Promise((resolve, reject) => {
        const proc = spawn('git', ['ls-remote', sshRepoUrl(), ref], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: sshEnv(deployKeyPath)
        });
        let stdout = '', stderr = '';
        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });
        proc.on('close', (code) => {
            if (code !== 0) return reject(new Error(`git ls-remote failed (${code}): ${stderr.trim()}`));
            const sha = stdout.trim().split(/\s+/)[0];
            if (!sha || sha.length < 40) return reject(new Error(`No commit found on ${ref}`));
            resolve(sha);
        });
        proc.on('error', reject);
    });
}

async function downloadAndInstallViaGit(channel, sha, deployKeyPath) {
    const branch = CHANNEL_REFS[channel];
    const dest = channelDir(channel);
    const tmp = dest + '._installing';

    await rm(tmp, { recursive: true, force: true });
    _progress.set(channel, { phase: 'starting', percent: 0, message: 'Starting download…' });

    try {
        await new Promise((resolve, reject) => {
            const proc = spawn('git', ['clone', '--depth', '1', '-b', branch, sshRepoUrl(), tmp], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: sshEnv(deployKeyPath)
            });
            let stderr = '';
            proc.stderr.on('data', (d) => {
                stderr += d;
                const s = d.toString();
                const recv = s.match(/Receiving objects:\s+(\d+)%/);
                if (recv) {
                    const pct = parseInt(recv[1], 10);
                    _progress.set(channel, {
                        phase: 'downloading',
                        percent: Math.round(10 + pct * 0.82),
                        message: `Downloading… ${pct}%`
                    });
                    return;
                }
                const resolv = s.match(/Resolving deltas:\s+(\d+)%/);
                if (resolv) {
                    const pct = parseInt(resolv[1], 10);
                    _progress.set(channel, {
                        phase: 'resolving',
                        percent: Math.round(92 + pct * 0.06),
                        message: `Installing… ${pct}%`
                    });
                    return;
                }
                if (/Compressing objects/.test(s)) {
                    _progress.set(channel, { phase: 'compressing', percent: 8, message: 'Preparing download…' });
                }
            });
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git clone failed (${code}): ${stderr.trim()}`)));
            proc.on('error', reject);
        });

        await rm(path.join(tmp, '.git'), { recursive: true, force: true });

        _progress.set(channel, { phase: 'installing', percent: 99, message: 'Installing…' });
        await writeFile(path.join(tmp, '.version'), sha, 'utf8');
        await swapIntoPlace(tmp, dest);

        _progress.delete(channel);
        console.log(`[SlicerWebUpdater] ${channel} updated to ${sha.slice(0, 12)} via SSH deploy key`);
    } catch (err) {
        _progress.delete(channel);
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
        throw err;
    }
}

export async function peekChannelUpdate(channel) {
    if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
    const deployKeyPath = await getDeployKeyPath();
    const [installedSha, latestSha] = await Promise.all([
        getInstalledSha(channel),
        deployKeyPath
            ? fetchLatestShaViaGit(channel, deployKeyPath)
            : fetchLatestSha(channel)
    ]);
    return { upToDate: installedSha === latestSha, installedSha, latestSha };
}

export async function checkAndUpdate(channel) {
    if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
    if (!config.slicerWeb.owner || !config.slicerWeb.repo) {
        throw new Error('SLICERWEB_REPO_URL is not set or could not be parsed');
    }

    if (_inFlight.has(channel)) return _inFlight.get(channel);

    const work = (async () => {
        const deployKeyPath = await getDeployKeyPath();
        const installed = await getInstalledSha(channel);
        const latest = deployKeyPath
            ? await fetchLatestShaViaGit(channel, deployKeyPath)
            : await fetchLatestSha(channel);
        if (installed === latest) return { upToDate: true, updated: false, sha: latest };
        if (!await shouldApplyUpdate(channel, latest)) return { upToDate: false, updated: false, sha: latest };
        if (deployKeyPath) {
            await downloadAndInstallViaGit(channel, latest, deployKeyPath);
        } else {
            await downloadAndInstall(channel, latest);
        }
        return { upToDate: false, updated: true, sha: latest };
    })();

    _inFlight.set(channel, work);
    try {
        return await work;
    } finally {
        _inFlight.delete(channel);
    }
}

export { getInstalledSha };

let _pollerStarted = false;
export function startStablePoller() {
    if (_pollerStarted) return;
    _pollerStarted = true;

    const intervalMs = config.slicerWeb.stableCheckIntervalMs;
    if (!intervalMs || !config.slicerWeb.hasCredentials) {
        console.log('[SlicerWebUpdater] Stable poller not started (no credentials or interval disabled)');
        return;
    }

    const run = () => checkAndUpdate('stable').catch(err =>
        console.warn('[SlicerWebUpdater] Stable update check failed:', err.message)
    );

    setTimeout(run, 60 * 1000);
    setInterval(run, intervalMs);
    console.log(`[SlicerWebUpdater] Stable poller started (every ${intervalMs / 60000} min)`);
}

let _latestPollerStarted = false;
export function startLatestPoller() {
    if (_latestPollerStarted) return;
    _latestPollerStarted = true;

    const intervalMs = config.slicerWeb.latestCheckIntervalMs;
    if (!config.slicerWeb.devModeEnabled) return;
    if (!intervalMs || !config.slicerWeb.hasCredentials) {
        console.log('[SlicerWebUpdater] Latest poller not started (no credentials or interval disabled)');
        return;
    }

    const run = () => checkAndUpdate('latest').catch(err =>
        console.warn('[SlicerWebUpdater] Latest update check failed:', err.message)
    );

    setTimeout(run, 30 * 1000);
    setInterval(run, intervalMs);
    console.log(`[SlicerWebUpdater] Latest poller started (every ${intervalMs / 60000} min)`);
}
