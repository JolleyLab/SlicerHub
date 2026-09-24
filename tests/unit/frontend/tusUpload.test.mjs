import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { tusUpload, TusError } from '../../../dev/services/tusUpload.js';

const ENDPOINT = 'http://localhost/api/directus/files/tus';
const UPLOAD_URL = 'http://localhost/api/directus/files/tus/upload-1';

/**
 * A scripted in-memory TUS server behind the transport interface. `hooks.patch(n)` may return an HTTP
 * status (or 'drop' for a network failure) to inject on the nth PATCH attempt.
 */
function fakeServer({ patch = () => null } = {}) {
    const state = { offset: 0, requests: [], patchAttempts: 0, metadata: null };
    const transport = async ({ method, url, headers = {}, body, onUploadProgress, signal }) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        state.requests.push({ method, url });
        if (method === 'POST') {
            state.metadata = headers['Upload-Metadata'];
            return { status: 201, header: (name) => (name === 'Location' ? UPLOAD_URL : null) };
        }
        if (method === 'HEAD') {
            return { status: 200, header: (name) => (name === 'Upload-Offset' ? String(state.offset) : null) };
        }
        state.patchAttempts += 1;
        const injected = patch(state.patchAttempts);
        if (injected === 'drop') throw new TusError('Network error', 0);
        if (injected) return { status: injected, header: () => null };
        assert.equal(Number(headers['Upload-Offset']), state.offset, 'client resumed at the server offset');
        state.offset += body.size;
        onUploadProgress?.(body.size);
        return { status: 204, header: (name) => (name === 'Upload-Offset' ? String(state.offset) : null) };
    };
    return { state, transport };
}

const makeFile = (size, name = 'scan.nrrd') => new File([new Uint8Array(size)], name, { type: 'application/x-nrrd' });
const run = (file, server, extra = {}) => tusUpload({
    file, endpoint: ENDPOINT, chunkSize: 1000, transport: server.transport, retryDelayMs: 1, ...extra
});

test('uploads in chunks and reports monotonic progress ending at 100%', async () => {
    const server = fakeServer();
    const progress = [];
    const result = await run(makeFile(2500), server, { onProgress: (sent, total) => progress.push(sent / total) });

    assert.equal(server.state.offset, 2500);
    assert.equal(server.state.patchAttempts, 3, 'chunks of 1000, 1000 and 500');
    assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));
    assert.equal(progress.at(-1), 1);
    assert.equal(result.uploadUrl, UPLOAD_URL);
});

test('sends the file name, type and caller metadata (base64) when creating the upload', async () => {
    const server = fakeServer();
    await run(makeFile(10), server, { metadata: { description: 'slicerweb-upload:abc' } });

    const decoded = Object.fromEntries(server.state.metadata.split(',').map((pair) => {
        const [key, value] = pair.split(' ');
        return [key, Buffer.from(value, 'base64').toString()];
    }));
    assert.deepEqual(decoded, {
        filename_download: 'scan.nrrd',
        type: 'application/x-nrrd',
        description: 'slicerweb-upload:abc'
    });
});

test('retries a transient server error and continues from the server offset', async () => {
    const server = fakeServer({ patch: (n) => (n === 2 ? 503 : null) });
    await run(makeFile(3000), server);
    assert.equal(server.state.offset, 3000);
    assert.ok(server.state.requests.some((r) => r.method === 'HEAD'), 'resynchronised with HEAD before retrying');
});

test('resumes after a dropped connection', async () => {
    const server = fakeServer({ patch: (n) => (n === 2 ? 'drop' : null) });
    await run(makeFile(3000), server);
    assert.equal(server.state.offset, 3000);
});

test('does not retry a permission error', async () => {
    const server = fakeServer({ patch: () => 403 });
    await assert.rejects(run(makeFile(500), server), { status: 403 });
    assert.equal(server.state.patchAttempts, 1);
});

test('gives up after repeated failures', async () => {
    const server = fakeServer({ patch: () => 503 });
    await assert.rejects(run(makeFile(500), server), { status: 503 });
    assert.ok(server.state.patchAttempts > 1 && server.state.patchAttempts < 10);
});

test('an aborted upload rejects with AbortError', async () => {
    const controller = new AbortController();
    const server = fakeServer({ patch: () => { controller.abort(); return null; } });
    await assert.rejects(run(makeFile(3000), server, { signal: controller.signal }), { name: 'AbortError' });
});

test('refuses an empty file', async () => {
    await assert.rejects(run(makeFile(0), fakeServer()), TusError);
});

test('error messages come from the catalog, and a failed request keeps its status', async () => {
    const { t } = await import('../../../dev/i18n/index.js');

    await assert.rejects(run(makeFile(0), fakeServer()), { message: t('uploads.errorEmptyFile') });
    await assert.rejects(run(makeFile(500), fakeServer({ patch: () => 403 })), (err) => {
        assert.equal(err.message, t('uploads.failed'));
        assert.equal(err.status, 403, 'the status is kept as data, not written into the message');
        return true;
    });
});
