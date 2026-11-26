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
// undici's fetch: Node 20's global fetch (undici 6) can't reliably use an undici 7 Agent.
import { Agent, fetch } from 'undici';

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

const subnets = (family, list) => {
    const blocks = new net.BlockList();
    for (const [prefix, bits] of list) blocks.addSubnet(prefix, bits, family);
    return blocks;
};

/** Private, loopback, link-local, CGNAT, multicast and reserved. Documentation ranges count as public (the tests use them). */
const NON_PUBLIC = {
    ipv4: subnets('ipv4', [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
        ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]),
    // Also 6to4, Teredo and local NAT64: they tunnel to IPv4 addresses we can't check.
    ipv6: subnets('ipv6', [['::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2002::', 16],
        ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]),
};
/** IPv4-mapped and NAT64: an IPv4 address in the last 32 bits. */
const EMBEDS_IPV4 = subnets('ipv6', [['::ffff:0:0', 96], ['64:ff9b::', 96]]);

function embeddedIPv4(ip) {
    const tail = ip.split(':').slice(-2);
    if (net.isIPv4(tail[1])) return tail[1]; // ::ffff:1.2.3.4
    const [hi, lo] = tail.map((h) => parseInt(h || '0', 16));
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** Anything not a parseable public address counts as non-public. */
export function isNonPublicAddress(ip) {
    const addr = String(ip).replace(/%.*$/, ''); // zone id (fe80::1%eth0)
    if (net.isIPv4(addr)) return NON_PUBLIC.ipv4.check(addr, 'ipv4');
    if (!net.isIPv6(addr)) return true;
    if (EMBEDS_IPV4.check(addr, 'ipv6')) return isNonPublicAddress(embeddedIPv4(addr));
    return NON_PUBLIC.ipv6.check(addr, 'ipv6');
}

/** DNS lookup used while connecting, so the checked address is the one connected to (no rebinding). */
export function publicOnlyLookup(hostname, options, callback) {
    lookup(hostname, { all: true }).then((addresses) => {
        if (!addresses.length || addresses.some(({ address }) => isNonPublicAddress(address))) {
            return callback(new Error(`${hostname} is not a public address`));
        }
        const usable = options?.family ? addresses.filter((a) => a.family === options.family) : addresses;
        if (!usable.length) return callback(new Error(`${hostname} has no IPv${options.family} address`));
        if (options?.all) return callback(null, usable);
        return callback(null, usable[0].address, usable[0].family);
    }, (err) => callback(err));
}

const publicOnly = new Agent({ connect: { lookup: publicOnlyLookup } });

/** https only. IP addresses in the URL skip DNS, so they're checked here rather than in publicOnlyLookup. */
function assertPublicHttps(url) {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') throw new Error('not https');
    const host = hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isNonPublicAddress(host)) throw new Error(`${host} is not a public address`);
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
        assertPublicHttps(url);
        response = await fetch(url, { redirect: 'manual', signal, dispatcher: publicOnly });
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
