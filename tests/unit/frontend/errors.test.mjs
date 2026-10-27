import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyCasesError } from '../../../dev/services/cases.js';
import { TusError, UPLOAD_NETWORK_ERROR } from '../../../dev/services/tusUpload.js';
import { t } from '../../../dev/i18n/index.js';

test('an upload network failure is recognised by its code, whatever the message says', () => {
    for (const message of ['Network error', 'Erreur réseau', 'anything at all']) {
        assert.equal(
            friendlyCasesError(message, 'fallback', 0, UPLOAD_NETWORK_ERROR),
            t('errors.serverUnreachable'),
            message
        );
    }
});

test('a TusError can carry a code and a status independently of its message', () => {
    const err = new TusError('whatever', 503, 'SOME_CODE');
    assert.deepEqual([err.status, err.code], [503, 'SOME_CODE']);
    assert.equal(new TusError('x').code, null);
});

test('the user-facing strings this feature relies on exist in the catalog', () => {
    for (const key of ['errors.serverUnreachable', 'uploads.failed', 'uploads.errorEmptyFile', 'cases.downloadFailed']) {
        assert.notEqual(t(key), key, `missing i18n key ${key}`);
    }
});
