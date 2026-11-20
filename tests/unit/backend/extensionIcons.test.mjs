import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { mock } from 'node:test';

// DNS: public hosts, and one that resolves to a private address.
// Public ones use the documentation ranges (RFC 5737).
const hosts = { 'github.com': '192.0.2.10', 'raw.githubusercontent.com': '192.0.2.11', 'example.com': '203.0.113.7', 'internal.example': '10.0.0.5' };
mock.module('dns/promises', { namedExports: {
    lookup: async (host) => (hosts[host] ? [{ address: hosts[host], family: 4 }] : Promise.reject(new Error(`ENOTFOUND ${host}`))),
} });

// A fake installed build and icon cache, set before config.js reads the environment.
const root = mkdtempSync(path.join(os.tmpdir(), 'ext-icons-'));
const stableDir = path.join(root, 'stable');
const cacheDir = path.join(root, 'cache');
mkdirSync(path.join(stableDir, 'extensions'), { recursive: true });
process.env.SLICERWEB_STABLE_DIR = stableDir;
process.env.SLICERWEB_ICON_CACHE_DIR = cacheDir;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]); // PNG signature + data
writeFileSync(path.join(stableDir, 'extensions', 'icon-Local.png'), PNG);
writeFileSync(path.join(stableDir, 'extensions', 'index.json'), JSON.stringify({ extensions: [
    { name: 'Local', icon: 'icon-Local.png' },
    { name: 'Remote', icon: 'https://github.com/x/Remote/raw/main/Remote.png' },
    { name: 'Svg', icon: 'https://example.com/logo.svg' },
    { name: 'Fake', icon: 'https://example.com/fake.png' },
    { name: 'Huge', icon: 'https://example.com/huge.png' },
    { name: 'Plain', icon: 'http://example.com/plain.png' },
    { name: 'Escape', icon: '../../secret.png' },
    { name: 'ToInternal', icon: 'https://example.com/redirect-internal.png' },
    { name: 'ToHttp', icon: 'https://example.com/redirect-http.png' },
    { name: 'Loop', icon: 'https://example.com/loop.png' },
    { name: 'PrivateIp', icon: 'https://10.1.2.3/icon.png' },
    { name: 'Chunked', icon: 'https://example.com/chunked-huge.png' },
    { name: 'NoIcon' },
] }));

const fetches = [];
const responses = {
    'https://example.com/logo.svg': { type: 'image/svg+xml', body: Buffer.from('<svg/>') },
    // Claims to be a PNG, but is HTML: refused by content.
    'https://example.com/fake.png': { type: 'image/png', body: Buffer.from('<html><script>alert(1)</script>') },
    'https://example.com/huge.png': { type: 'image/png', body: Buffer.alloc(600 * 1024) },
};
const redirects = {
    'https://github.com/x/Remote/raw/main/Remote.png': 'https://raw.githubusercontent.com/x/Remote/main/Remote.png',
    'https://example.com/redirect-internal.png': 'https://internal.example/secret',
    'https://example.com/redirect-http.png': 'http://example.com/plain.png',
    'https://example.com/loop.png': 'https://example.com/loop.png',
};
responses['https://raw.githubusercontent.com/x/Remote/main/Remote.png'] = { type: 'image/png', body: PNG };
globalThis.fetch = async (url, init = {}) => {
    fetches.push(url);
    assert.equal(init.redirect, 'manual');
    if (redirects[url]) return new Response(null, { status: 302, headers: { location: redirects[url] } });
    if (url === 'https://example.com/chunked-huge.png') {
        // No Content-Length: the cap has to be applied while reading.
        let sent = 0;
        const stream = new ReadableStream({ pull(c) { sent += 1; if (sent > 100) c.close(); else c.enqueue(new Uint8Array(64 * 1024)); } });
        return new Response(stream, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    const r = responses[url];
    if (!r) return new Response(null, { status: 404 });
    return new Response(r.body, { status: 200, headers: { 'content-type': r.type } });
};

const { resolveExtensionIcon, isNonPublicAddress } = await import('../../../backend/src/services/extensionIcons.js');

test('an icon shipped with the build is served from the build', async () => {
    const icon = await resolveExtensionIcon('stable', 'Local');
    assert.equal(icon.contentType, 'image/png');
    assert.equal(icon.file, path.join(stableDir, 'extensions', 'icon-Local.png'));
    assert.deepEqual(fetches, []);
});

test('a remote icon is fetched once from the listed URL, then served from the copy', async () => {
    const first = await resolveExtensionIcon('stable', 'Remote');
    assert.equal(first.contentType, 'image/png');
    assert.deepEqual(readFileSync(first.file), PNG);
    assert.ok(first.file.startsWith(cacheDir));
    const again = await resolveExtensionIcon('stable', 'Remote');
    assert.equal(again.file, first.file);
    assert.deepEqual(fetches, [
        'https://github.com/x/Remote/raw/main/Remote.png',
        'https://raw.githubusercontent.com/x/Remote/main/Remote.png',
    ]);
});

test('SVG, oversized, plain-http and missing icons are refused', async () => {
    for (const name of ['Svg', 'Fake', 'Huge', 'Plain', 'NoIcon', 'NotInIndex']) {
        assert.equal(await resolveExtensionIcon('stable', name), null, name);
    }
    assert.ok(!fetches.includes('http://example.com/plain.png'));
    assert.equal(readdirSync(cacheDir).filter((f) => !f.endsWith('.png') || f.includes('tmp')).length, 0);
});

test('a failed fetch is not retried straight away', async () => {
    const before = fetches.filter((u) => u.endsWith('logo.svg')).length;
    await resolveExtensionIcon('stable', 'Svg');
    assert.equal(fetches.filter((u) => u.endsWith('logo.svg')).length, before);
});

test('a local icon path cannot leave the extensions folder', async () => {
    writeFileSync(path.join(root, 'secret.png'), PNG);
    assert.equal(await resolveExtensionIcon('stable', 'Escape'), null);
});

test('a channel without an installed build has no icons', async () => {
    assert.equal(await resolveExtensionIcon('latest', 'Local'), null);
});

test('redirects are followed only to public https addresses, and only a few times', async () => {
    for (const name of ['ToInternal', 'ToHttp', 'Loop', 'PrivateIp']) {
        assert.equal(await resolveExtensionIcon('stable', name), null, name);
    }
    assert.ok(!fetches.includes('https://internal.example/secret'), 'never requested the internal host');
    assert.ok(!fetches.includes('http://example.com/plain.png'), 'never requested plain http');
    assert.ok(!fetches.some((u) => u.startsWith('https://10.')), 'never requested a private IP');
    assert.equal(fetches.filter((u) => u === 'https://example.com/loop.png').length, 4); // first try + 3 redirects
});

test('a body without a Content-Length is cut off at the size limit', async () => {
    assert.equal(await resolveExtensionIcon('stable', 'Chunked'), null);
});

test('isNonPublicAddress covers private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
        '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
        assert.equal(isNonPublicAddress(ip), true, ip);
    }
    for (const ip of ['192.0.2.10', '203.0.113.7', '172.32.0.1', '2001:db8::1']) {
        assert.equal(isNonPublicAddress(ip), false, ip);
    }
});
