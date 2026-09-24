import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// express is a backend dependency; resolve it from there rather than duplicating it here.
const express = createRequire(new URL('../../../backend/package.json', import.meta.url))('express');

const { createAttachmentDownloadHandler, streamAssetToResponse } =
    await import('../../../backend/src/services/attachmentDownload.js');

const stop = (server) => { server.closeAllConnections?.(); server.close(); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The download handler behind a tiny app that turns thrown errors into their status code. */
async function startApp(deps) {
    const app = express();
    const handler = createAttachmentDownloadHandler(deps);
    app.get('/download', (req, res, next) => handler(req, res).catch(next));
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}/download` };
}

const ATTACHMENT = { id: 'a1', fileId: 'f1', filenameDownload: 'baseline_ct.nrrd', filesize: 12 };

/** An upstream body the test releases chunk by chunk; also records whether the request was aborted. */
function controllableUpstream(signal) {
    let controller;
    const body = new ReadableStream({ start(c) { controller = c; } });
    const state = { aborted: false };
    signal.addEventListener('abort', () => { state.aborted = true; });
    return { state, controller, response: { headers: new Headers({ 'content-length': '12' }), body } };
}

test('HEAD only checks access: it never touches the cache or Directus, and answers with the file details', async (t) => {
    const calls = [];
    const { server, url } = await startApp({
        authorize: async () => { calls.push('authorize'); return ATTACHMENT; },
        findCached: () => { calls.push('findCached'); return null; },
        fetchAsset: async () => { calls.push('fetchAsset'); }
    });
    t.after(() => stop(server));

    const res = await fetch(url, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, ['authorize']);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="baseline_ct\.nrrd"/);
    assert.equal(res.headers.get('content-length'), '12');
});

test('GET serves the cached copy without asking Directus', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cachePath = path.join(dir, 'cached.bin');
    fs.writeFileSync(cachePath, 'cached-bytes!');
    let fetched = false;
    const { server, url } = await startApp({
        authorize: async () => ATTACHMENT,
        findCached: () => ({ cachePath, fileName: 'baseline_ct.nrrd' }),
        fetchAsset: async () => { fetched = true; }
    });
    t.after(() => stop(server));

    const res = await fetch(url);
    assert.equal(await res.text(), 'cached-bytes!');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="baseline_ct\.nrrd"/);
    assert.equal(fetched, false);
});

test('GET without a cached copy streams: the first bytes arrive before Directus has finished', async (t) => {
    let upstream;
    const { server, url } = await startApp({
        authorize: async () => ATTACHMENT,
        findCached: () => null,
        fetchAsset: async (attachment, token, signal) => { upstream = controllableUpstream(signal); return upstream.response; }
    });
    t.after(() => stop(server));

    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '12', "Directus' length is passed on so the browser can show progress");
    assert.match(res.headers.get('content-disposition'), /attachment/);

    const reader = res.body.getReader();
    upstream.controller.enqueue(new TextEncoder().encode('first-'));
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), 'first-', 'received while the upstream is still open');

    upstream.controller.enqueue(new TextEncoder().encode('chunk2'));
    upstream.controller.close();
    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value);
    assert.equal(rest, 'chunk2');
});

test('cancelling the download aborts the request to Directus', async (t) => {
    let upstream;
    const { server, url } = await startApp({
        authorize: async () => ATTACHMENT,
        findCached: () => null,
        fetchAsset: async (attachment, token, signal) => { upstream = controllableUpstream(signal); return upstream.response; }
    });
    t.after(() => stop(server));

    const client = new AbortController();
    const res = await fetch(url, { signal: client.signal });
    upstream.controller.enqueue(new TextEncoder().encode('partial'));
    await res.body.getReader().read();

    client.abort();
    for (let i = 0; i < 40 && !upstream.state.aborted; i += 1) await sleep(25);
    assert.equal(upstream.state.aborted, true, 'nothing keeps downloading for a browser that left');
});

test('a refused caller gets the error status and Directus is never asked for the file', async (t) => {
    const calls = [];
    const { server, url } = await startApp({
        authorize: async () => { throw Object.assign(new Error('read-only'), { statusCode: 403 }); },
        findCached: () => { calls.push('findCached'); return null; },
        fetchAsset: async () => { calls.push('fetchAsset'); }
    });
    t.after(() => stop(server));

    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 403);
    assert.deepEqual(calls, []);
});

test('an error from Directus before any bytes are sent is a normal error response, not a download', async (t) => {
    const { server, url } = await startApp({
        authorize: async () => ATTACHMENT,
        findCached: () => null,
        fetchAsset: async () => { throw Object.assign(new Error('Directus is down'), { statusCode: 502 }); }
    });
    t.after(() => stop(server));

    const res = await fetch(url);
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('content-disposition'), null, 'no file was offered');
});

test('a stream that fails midway cuts the connection so the browser reports a failed download', async (t) => {
    t.mock.method(console, 'warn', () => {});
    let upstream;
    const { server, url } = await startApp({
        authorize: async () => ATTACHMENT,
        findCached: () => null,
        fetchAsset: async (attachment, token, signal) => { upstream = controllableUpstream(signal); return upstream.response; }
    });
    t.after(() => stop(server));

    const res = await fetch(url);
    upstream.controller.enqueue(new TextEncoder().encode('partial'));
    upstream.controller.error(new Error('upstream died'));
    await assert.rejects(res.arrayBuffer(), 'a truncated body is an error, not a complete (corrupt) file');
});

test('streamAssetToResponse is exported for reuse and takes the fetch as a function', () => {
    assert.equal(typeof streamAssetToResponse, 'function');
});
