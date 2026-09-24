import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Importing the service pulls in the app config and database; keep that in a scratch file.
const scratchDb = path.join(os.tmpdir(), `attach-uploaded-file-test-${process.pid}.db`);
process.env.DB_PATH = scratchDb;
process.env.DB_SEED_PATH = `${scratchDb}.no-seed`;
test.after(() => fs.rmSync(scratchDb, { force: true }));

const { attachUploadedFileToCase } = await import('../../../backend/src/services/attachUploadedFile.js');
const { issueUploadToken } = await import('../../../backend/src/services/uploadTokens.js');
const { msg } = await import('../../../backend/src/i18n/index.js');

const SECRET = 'test-secret-not-used-anywhere-else';
const USER_ID = 42;
const FILE_ID = '74ba3e75-ec4e-4c2f-9115-5f47ca404f69';
const quiet = { info() {}, warn() {} };

/** A fake Directus: `rows` is what the marker lookup returns; records every call. */
function fakeDirectus({ rows = [{ id: FILE_ID }], lookupError = null, patchError = null } = {}) {
    const calls = { lookups: [], patches: [], attachments: [] };
    return {
        calls,
        deps: {
            log: quiet,
            secret: SECRET,
            fetchDirectus: async (pathName, { method = 'GET', query, body } = {}) => {
                if (method === 'PATCH') {
                    calls.patches.push({ pathName, body });
                    if (patchError) throw patchError;
                    return { data: {} };
                }
                calls.lookups.push({ pathName, query });
                if (lookupError) throw lookupError;
                return { data: rows };
            },
            createAttachment: async (caseId, fileId, name) => {
                calls.attachments.push({ caseId, fileId, name });
                return { id: 'attachment-1', name };
            }
        }
    };
}

/** What the client holds after starting an upload: the token, plus the metadata the file was tagged with. */
const startUpload = (userId = USER_ID) => issueUploadToken(userId, { secret: SECRET });

const attach = (deps, { issued = startUpload(), userId = USER_ID, ...extra } = {}) => attachUploadedFileToCase({
    caseId: 'case-1',
    userId,
    uploadToken: issued.uploadToken,
    displayName: 'Baseline CT',
    fileMeta: {},
    accessToken: 'user-token',
    ...extra
}, deps);

test('finds the file by the marker its token was issued with, and attaches it', async () => {
    const issued = startUpload();
    const { calls, deps } = fakeDirectus();
    const result = await attach(deps, { issued });

    assert.equal(result.fileId, FILE_ID);
    assert.deepEqual(calls.attachments, [{ caseId: 'case-1', fileId: FILE_ID, name: 'Baseline CT' }]);
    assert.equal(calls.lookups[0].query['filter[description][_eq]'], issued.metadata.description);
});

test('clears the marker from the file afterwards', async () => {
    const { calls, deps } = fakeDirectus();
    await attach(deps);
    assert.equal(calls.patches.length, 1);
    assert.ok(calls.patches[0].pathName.endsWith(FILE_ID));
    assert.deepEqual(calls.patches[0].body, { description: null });
});

test('a failure while clearing the marker does not fail the attach', async () => {
    const { deps } = fakeDirectus({ patchError: new Error('refused') });
    assert.equal((await attach(deps)).fileId, FILE_ID);
});

test('no file carries the marker -> UPLOAD_FILE_NOT_LINKABLE, nothing attached', async () => {
    const { calls, deps } = fakeDirectus({ rows: [] });
    await assert.rejects(attach(deps), { code: 'UPLOAD_FILE_NOT_LINKABLE', statusCode: 502 });
    assert.equal(calls.attachments.length, 0);
});

test('two files with the same marker are never trusted', async () => {
    const { calls, deps } = fakeDirectus({ rows: [{ id: FILE_ID }, { id: 'another-file' }] });
    await assert.rejects(attach(deps), { code: 'UPLOAD_FILE_NOT_LINKABLE' });
    assert.equal(calls.attachments.length, 0);
});

test("another user's token cannot link the file, and nothing is sent to Directus", async () => {
    const { calls, deps } = fakeDirectus();
    await assert.rejects(attach(deps, { issued: startUpload(43) }), { code: 'UPLOAD_TOKEN_INVALID', statusCode: 400 });
    assert.equal(calls.lookups.length, 0);
    assert.equal(calls.attachments.length, 0);
});

test('a missing or malformed token is rejected before anything is sent to Directus', async () => {
    const { calls, deps } = fakeDirectus();
    for (const uploadToken of [undefined, '', 'x" OR 1=1']) {
        await assert.rejects(attach(deps, { issued: { uploadToken } }), { code: 'UPLOAD_TOKEN_INVALID' });
    }
    assert.equal(calls.lookups.length, 0);
});

test('Directus errors during the lookup (permissions, etc.) pass through unchanged', async () => {
    const forbidden = Object.assign(new Error('You do not have permission'), { statusCode: 403 });
    const { calls, deps } = fakeDirectus({ lookupError: forbidden });
    await assert.rejects(attach(deps), (err) => err === forbidden);
    assert.equal(calls.attachments.length, 0);
});

test('a successful attach is silent (no routine log lines)', async () => {
    const { deps } = fakeDirectus();
    const noisy = () => assert.fail('nothing should be logged on success');
    await attach({ ...deps, log: { info: noisy, warn: noisy, error: noisy } });
});

test('an ambiguous marker is logged once, as a warning with the match count', async () => {
    const warnings = [];
    const { deps } = fakeDirectus({ rows: [{ id: FILE_ID }, { id: 'another-file' }] });
    await assert.rejects(attach({ ...deps, log: { warn: (...args) => warnings.push(args) } }), { code: 'UPLOAD_FILE_NOT_LINKABLE' });
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0][1], { matches: 2 });
});

test('a marker that could not be cleared is a warning, not silence', async () => {
    const warnings = [];
    const { deps } = fakeDirectus({ patchError: new Error('refused') });
    await attach({ ...deps, log: { warn: (...args) => warnings.push(args) } });
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /clear the upload marker/);
});

test('user-facing failures come from the message catalog and carry its key', async () => {
    const { deps } = fakeDirectus({ rows: [] });
    await assert.rejects(attach(deps), (err) => {
        assert.equal(err.message, msg('upload.file_not_linkable'));
        assert.equal(err.messageKey, 'upload.file_not_linkable');
        assert.notEqual(err.message, 'upload.file_not_linkable', 'the key exists in the catalog');
        return true;
    });
});
