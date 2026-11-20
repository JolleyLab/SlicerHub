/**
 * Icons for SlicerWeb extensions, served from SlicerHub itself.
 *
 * A build's extensions/index.json gives each extension an `icon`: a file shipped with the build,
 * or (mostly) an https URL on GitHub. Browsers loading those URLs directly would tell GitHub who
 * is browsing which extensions, so the backend fetches each remote icon once and serves its copy.
 *
 * Only the exact URL the index lists for that extension is fetched (never one from a request).
 * Every hop, redirects included, must be https to a public address: an icon URL whose GitHub
 * account or domain has changed hands mustn't be able to point the server at internal services.
 * Bodies are capped at MAX_BYTES while reading, and only raster images (checked by content) are
 * kept: SVG can carry script, so it's refused.
 * Copies are kept on disk (keyed by a hash of the URL, so a new build reusing the same icon reuses
 * the copy). A failed fetch isn't retried for FAILURE_TTL_MS.
 */

import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import net from 'net';
import { mkdir, readFile, writeFile, rename, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import config from '../config/index.js';
import { sniffImageType } from '../utils/storedImage.js';

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const MAX_REDIRECTS = 3;
const TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const EXT_TYPES = Object.freeze(Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type])));

const cacheDir = () => (process.env.SLICERWEB_ICON_CACHE_DIR || path.join(os.tmpdir(), 'slicerweb-icons')).trim();
const channelDir = (channel) => (channel === 'latest' ? config.slicerWeb.latestDir : config.slicerWeb.stableDir);

const indexCache = new Map();   // channel -> { mtimeMs, byName }
const inFlight = new Map();     // url -> Promise<file|null>
const failedAt = new Map();     // url -> time of last failed fetch

async function iconRefFor(channel, name) {
    const file = path.join(channelDir(channel), 'extensions', 'index.json');
    const { mtimeMs } = await stat(file);
    let cached = indexCache.get(channel);
    if (!cached || cached.mtimeMs !== mtimeMs) {
        const index = JSON.parse(await readFile(file, 'utf8'));
        const byName = new Map((index.extensions || []).map((e) => [e.name, e.icon]));
        cached = { mtimeMs, byName };
        indexCache.set(channel, cached);
    }
    return cached.byName.get(name) || null;
}

const typeOfFile = (file) => EXT_TYPES[path.extname(file).slice(1).toLowerCase()] || null;

async function exists(file) {
    try { return (await stat(file)).isFile(); } catch { return false; }
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isNonPublicAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168);
    }
    const v = String(ip).toLowerCase();
    if (v.startsWith('::ffff:')) return isNonPublicAddress(v.slice(7));
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
}

/** Refuse anything but https to a host whose every address is public. */
async function assertPublicHttps(url) {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') throw new Error('not https');
    const host = hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isNonPublicAddress(address))) {
        throw new Error(`${host} is not a public address`);
    }
}

/** The body, read in chunks and abandoned as soon as it passes `max` bytes. */
async function readCapped(response, max) {
    if (Number(response.headers.get('content-length')) > max) throw new Error('too large');
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
            await reader.cancel().catch(() => {});
            throw new Error('too large');
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

async function download(startUrl) {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let url = startUrl;
    let response;
    for (let hop = 0; ; hop += 1) {
        await assertPublicHttps(url);
        response = await fetch(url, { redirect: 'manual', signal });
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || !location) break;
        if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
        url = new URL(location, url).href;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await readCapped(response, MAX_BYTES);
    const ext = sniffImageType(body);
    if (!ext) throw new Error('not a PNG, JPEG, GIF or WebP image');
    return { body, ext };
}

async function cachedCopy(url) {
    const key = createHash('sha256').update(url).digest('hex');
    const dir = cacheDir();
    for (const ext of Object.values(TYPES)) {
        const file = path.join(dir, `${key}.${ext}`);
        if (await exists(file)) return file;
    }
    if (Date.now() - (failedAt.get(url) || 0) < FAILURE_TTL_MS) return null;
    if (!inFlight.has(url)) {
        inFlight.set(url, (async () => {
            try {
                const { body, ext } = await download(url);
                await mkdir(dir, { recursive: true });
                const file = path.join(dir, `${key}.${ext}`);
                const tmp = `${file}.${process.pid}.tmp`;
                await writeFile(tmp, body);
                await rename(tmp, file);
                return file;
            } catch (err) {
                failedAt.set(url, Date.now());
                console.warn(`[extensionIcons] could not fetch ${url}: ${err.message}`);
                return null;
            } finally {
                inFlight.delete(url);
            }
        })());
    }
    return inFlight.get(url);
}

/**
 * The icon file to serve for an extension of a channel's build: { file, contentType }, or null
 * when it has none (unknown extension, no icon, unfetchable, or not an allowed image).
 */
export async function resolveExtensionIcon(channel, name) {
    let ref;
    try {
        ref = await iconRefFor(channel, name);
    } catch {
        return null; // build not installed
    }
    if (!ref) return null;

    let file;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
        if (!ref.startsWith('https://')) return null;
        file = await cachedCopy(ref);
    } else {
        // Shipped with the build, next to index.json: a bare file name only.
        file = path.join(channelDir(channel), 'extensions', path.basename(ref));
        if (!(await exists(file))) return null;
    }
    const contentType = file && typeOfFile(file);
    return contentType ? { file, contentType } : null;
}
