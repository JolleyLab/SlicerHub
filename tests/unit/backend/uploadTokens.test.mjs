import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// jsonwebtoken is a backend dependency; resolve it from there rather than duplicating it here.
const jwt = createRequire(new URL('../../../backend/package.json', import.meta.url))('jsonwebtoken');

// Importing the service pulls in the app config; keep any database it opens in a scratch file.
const scratchDb = path.join(os.tmpdir(), `upload-tokens-test-${process.pid}.db`);
process.env.DB_PATH = scratchDb;
process.env.DB_SEED_PATH = `${scratchDb}.no-seed`;
test.after(() => fs.rmSync(scratchDb, { force: true }));

const { issueUploadToken, verifyUploadToken, uploadMarker } =
    await import('../../../backend/src/services/uploadTokens.js');
const { msg } = await import('../../../backend/src/i18n/index.js');

const SECRET = 'test-secret-not-used-anywhere-else';
const opts = { secret: SECRET };

test('a token verifies for the user it was issued to and yields the nonce behind the marker', () => {
    const { uploadToken, metadata } = issueUploadToken(42, opts);
    const nonce = verifyUploadToken(uploadToken, 42, opts);

    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.equal(metadata.description, uploadMarker(nonce), 'the metadata the client sends carries the same nonce');
});

test('every token carries a fresh nonce', () => {
    const a = issueUploadToken(1, opts);
    const b = issueUploadToken(1, opts);
    assert.notEqual(a.metadata.description, b.metadata.description);
    assert.notEqual(a.uploadToken, b.uploadToken);
});

test("another user's token is rejected", () => {
    const { uploadToken } = issueUploadToken(42, opts);
    assert.throws(() => verifyUploadToken(uploadToken, 43, opts), { code: 'UPLOAD_TOKEN_INVALID', statusCode: 400 });
});

test('an expired token is rejected', () => {
    const { uploadToken } = issueUploadToken(42, { ...opts, expiresInSeconds: -10 });
    assert.throws(() => verifyUploadToken(uploadToken, 42, opts), { code: 'UPLOAD_TOKEN_INVALID' });
});

test('a token signed with a different secret, or tampered with, is rejected', () => {
    const { uploadToken } = issueUploadToken(42, { secret: 'some-other-secret' });
    assert.throws(() => verifyUploadToken(uploadToken, 42, opts), { code: 'UPLOAD_TOKEN_INVALID' });

    const genuine = issueUploadToken(42, opts).uploadToken;
    const [header, payload, signature] = genuine.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: '43' })).toString('base64url');
    assert.throws(() => verifyUploadToken(`${header}.${forgedPayload}.${signature}`, 43, opts), { code: 'UPLOAD_TOKEN_INVALID' });
});

test('a session-style JWT signed with the raw secret can never pass as an upload token', () => {
    const sessionLike = jwt.sign({ purpose: 'directus-upload-link', nonce: '0123456789abcdef0123456789abcdef' }, SECRET, { subject: '42' });
    assert.throws(() => verifyUploadToken(sessionLike, 42, opts), { code: 'UPLOAD_TOKEN_INVALID' });
});

test('missing or garbage tokens are rejected', () => {
    for (const bad of [undefined, null, '', 'not-a-jwt', 'a.b.c', 123]) {
        assert.throws(() => verifyUploadToken(bad, 42, opts), { code: 'UPLOAD_TOKEN_INVALID' }, String(bad));
    }
});

test('the rejection message comes from the message catalog and carries its key', () => {
    assert.throws(() => verifyUploadToken('garbage', 42, opts), (err) => {
        assert.equal(err.message, msg('upload.token_invalid'));
        assert.equal(err.messageKey, 'upload.token_invalid');
        assert.notEqual(err.message, 'upload.token_invalid', 'the key exists in the catalog');
        return true;
    });
});
