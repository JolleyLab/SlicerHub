import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { uploadFileResumable } from '../../../dev/services/directus.js';

const UPLOAD_URL = 'http://localhost/api/directus/files/tus/upload-1';

/** Stub the app's token endpoint (global fetch) and record what the client asked for. */
function stubTokenEndpoint(t, reply) {
    const requests = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method, credentials: init.credentials });
        return { ok: reply.ok !== false, status: reply.status ?? 200, json: async () => reply.body };
    };
    t.after(() => { globalThis.fetch = original; });
    return requests;
}

/** A TUS server behind the transport interface that records the metadata it was sent. */
function fakeTusServer() {
    const state = { metadata: null, offset: 0, requests: [] };
    const transport = async ({ method, headers = {}, body }) => {
        state.requests.push(method);
        if (method === 'POST') {
            state.metadata = headers['Upload-Metadata'];
            return { status: 201, header: (name) => (name === 'Location' ? UPLOAD_URL : null) };
        }
        state.offset += body.size;
        return { status: 204, header: (name) => (name === 'Upload-Offset' ? String(state.offset) : null) };
    };
    return { state, transport };
}

const decode = (header) => Object.fromEntries(header.split(',').map((pair) => {
    const [key, value] = pair.split(' ');
    return [key, Buffer.from(value, 'base64').toString()];
}));

test('asks the server to start the upload, then sends the metadata it returned unchanged', async (t) => {
    // A description in a format the client has never heard of: it must be forwarded as-is.
    const requests = stubTokenEndpoint(t, { body: { uploadToken: 'opaque-token', metadata: { description: 'server-chosen-marker-123' } } });
    const server = fakeTusServer();

    const result = await uploadFileResumable(new File([new Uint8Array(100)], 'scan.nrrd'), { transport: server.transport });

    assert.deepEqual(result, { uploadToken: 'opaque-token' });
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/api\/directus\/uploads\/token$/);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].credentials, 'include');
    assert.equal(decode(server.state.metadata).description, 'server-chosen-marker-123');
    assert.equal(server.state.offset, 100, 'the bytes were sent');
});

test('no upload is started when the server refuses to issue a token', async (t) => {
    stubTokenEndpoint(t, { ok: false, status: 403, body: { error: { message: 'Forbidden' } } });
    const server = fakeTusServer();

    await assert.rejects(
        uploadFileResumable(new File([new Uint8Array(10)], 'a.bin'), { transport: server.transport }),
        { status: 403 }
    );
    assert.deepEqual(server.state.requests, [], 'nothing was sent to the upload endpoint');
});
