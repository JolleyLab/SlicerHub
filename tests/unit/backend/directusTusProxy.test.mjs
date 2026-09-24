import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

// express is a backend dependency; resolve it from there rather than duplicating it here.
const express = createRequire(new URL('../../../backend/package.json', import.meta.url))('express');

const { createTusProxyHandler, rewriteTusLocation, TUS_PROXY_PATH } =
    await import('../../../backend/src/services/tusProxy.js');
const { msg } = await import('../../../backend/src/i18n/index.js');

/** Close a test server and drop keep-alive connections, or the test process never exits. */
const stop = (...servers) => servers.forEach((server) => { server.closeAllConnections?.(); server.close(); });

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** A stand-in for Directus' /files/tus endpoint that records what it was sent. */
async function startFakeDirectus() {
    const received = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            received.push({ method: req.method, url: req.url, headers: req.headers, body });
            if (req.method === 'POST') {
                res.writeHead(201, { Location: 'https://directus.example/files/tus/abc123', 'Tus-Resumable': '1.0.0' }).end();
            } else {
                const offset = Number(req.headers['upload-offset'] || 0) + body.length;
                res.writeHead(204, { 'Upload-Offset': String(offset) }).end();
            }
        });
    });
    const port = await listen(server);
    return { server, received, url: `http://127.0.0.1:${port}` };
}

/** The real proxy handler behind a stub that stands in for the auth middleware. */
async function startProxy(directusUrl) {
    const app = express();
    const stubAuth = (req, _res, next) => { req.directusAccessToken = 'user-token'; next(); };
    const handler = createTusProxyHandler({ directusUrl });
    app.all(TUS_PROXY_PATH, stubAuth, handler);
    app.all(`${TUS_PROXY_PATH}/:uploadId`, stubAuth, handler);
    const server = http.createServer(app);
    const port = await listen(server);
    return { server, url: `http://127.0.0.1:${port}${TUS_PROXY_PATH}` };
}

test('creates an upload with the user token added server-side and a Location that points at the proxy', async (t) => {
    const directus = await startFakeDirectus();
    const proxy = await startProxy(directus.url);
    t.after(() => stop(directus.server, proxy.server));

    const res = await fetch(proxy.url, {
        method: 'POST',
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Length': '10',
            'Upload-Metadata': 'filename_download YS5iaW4=',
            Authorization: 'Bearer attacker-supplied',
            Cookie: 'session=secret'
        }
    });

    assert.equal(res.status, 201);
    assert.equal(res.headers.get('location'), `${TUS_PROXY_PATH}/abc123`);
    const seen = directus.received[0];
    assert.equal(seen.headers.authorization, 'Bearer user-token', "the caller's own Authorization header is never forwarded");
    assert.equal(seen.headers.cookie, undefined, 'cookies are never forwarded');
    assert.equal(seen.headers['upload-length'], '10');
    assert.equal(seen.headers['upload-metadata'], 'filename_download YS5iaW4=');
});

test('streams a chunk through unchanged and returns the new offset', async (t) => {
    const directus = await startFakeDirectus();
    const proxy = await startProxy(directus.url);
    t.after(() => stop(directus.server, proxy.server));

    const chunk = Buffer.from('0123456789abcdef');
    const res = await fetch(`${proxy.url}/abc123`, {
        method: 'PATCH',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '32', 'Content-Type': 'application/offset+octet-stream' },
        body: chunk
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('upload-offset'), '48');
    const seen = directus.received[0];
    assert.equal(seen.url, '/files/tus/abc123');
    assert.deepEqual(seen.body, chunk);
    assert.equal(seen.headers['upload-offset'], '32');
});

test('rejects PATCH on the collection and POST on a single upload', async (t) => {
    const directus = await startFakeDirectus();
    const proxy = await startProxy(directus.url);
    t.after(() => stop(directus.server, proxy.server));

    assert.equal((await fetch(proxy.url, { method: 'PATCH' })).status, 405);
    assert.equal((await fetch(`${proxy.url}/abc123`, { method: 'POST' })).status, 405);
    assert.equal(directus.received.length, 0, 'nothing reached Directus');
});

test('answers 502 when Directus is unreachable', async (t) => {
    const proxy = await startProxy('http://127.0.0.1:1');
    t.after(() => stop(proxy.server));

    const res = await fetch(proxy.url, { method: 'POST', headers: { 'Upload-Length': '1' } });
    assert.equal(res.status, 502);
});

test('rewriteTusLocation maps a Directus upload URL to the proxy path', () => {
    assert.equal(rewriteTusLocation('https://x.example/files/tus/abc-123'), `${TUS_PROXY_PATH}/abc-123`);
    assert.equal(rewriteTusLocation(null), null);
    assert.equal(rewriteTusLocation('https://x.example/other'), null);
});

test('errors use the app error body, with messages from the catalog', async (t) => {
    const directus = await startFakeDirectus();
    const proxy = await startProxy(directus.url);
    t.after(() => stop(directus.server, proxy.server));

    const notAllowed = await fetch(proxy.url, { method: 'PATCH' });
    assert.deepEqual(await notAllowed.json(), {
        error: { message: msg('upload.method_not_allowed'), code: 'METHOD_NOT_ALLOWED', key: 'upload.method_not_allowed' }
    });

    t.mock.method(console, 'error', () => {});
    const dead = await startProxy('http://127.0.0.1:1');
    t.after(() => stop(dead.server));
    const unreachable = await fetch(dead.url, { method: 'POST', headers: { 'Upload-Length': '1' } });
    assert.deepEqual(await unreachable.json(), {
        error: { message: msg('upload.file_server_unreachable'), code: 'FILE_SERVER_UNREACHABLE', key: 'upload.file_server_unreachable' }
    });
});

test('log levels: Directus unreachable is an error; a 4xx is silent; a 5xx is a warning', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const warnings = t.mock.method(console, 'warn', () => {});

    const dead = await startProxy('http://127.0.0.1:1');
    t.after(() => stop(dead.server));
    await fetch(dead.url, { method: 'POST', headers: { 'Upload-Length': '1' } });
    assert.equal(errors.mock.callCount(), 1);
    assert.equal(warnings.mock.callCount(), 0);

    // A Directus that answers each request with the status we ask for.
    let status = 409;
    const answering = http.createServer((req, res) => { req.resume(); req.on('end', () => res.writeHead(status).end()); });
    await new Promise((resolve) => answering.listen(0, '127.0.0.1', resolve));
    const proxy = await startProxy(`http://127.0.0.1:${answering.address().port}`);
    t.after(() => stop(answering, proxy.server));

    await fetch(`${proxy.url}/abc123`, { method: 'HEAD' });                // 409: normal protocol traffic
    assert.equal(warnings.mock.callCount(), 0, 'a 4xx from Directus is not logged');
    status = 503;
    await fetch(`${proxy.url}/abc123`, { method: 'HEAD' });
    assert.equal(warnings.mock.callCount(), 1, 'a 5xx from Directus is logged once');
});
