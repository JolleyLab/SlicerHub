import test from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorText, apiError } from '../../../dev/services/apiResponse.js';
import browserCatalog from '../../../dev/i18n/locales/en.js';
import serverCatalog from '../../../backend/src/i18n/locales/en.js';

/** Every string's key in a catalog section: { a: { b: 'x' } } → ['a.b']. */
const keysOf = (section, prefix = '') => Object.entries(section).flatMap(([key, value]) => (
    typeof value === 'string' ? [`${prefix}${key}`] : keysOf(value, `${prefix}${key}.`)));

test('a keyed API error is shown in the browser catalog, with its vars filled in', () => {
    assert.equal(
        apiErrorText({ key: 'workflow.too_many_pending', vars: { max: 3 }, message: 'server English' }),
        'You can have at most 3 requests waiting in this case. Cancel one to ask for another.',
    );
});

test('a field var names the field in the browser language too', () => {
    assert.equal(
        apiErrorText({ key: 'validation.too_long', vars: { field: 'workflow.fields.name', max: 100 } }),
        'Name can be at most 100 characters.',
    );
});

test('an error without a key, or with one the browser catalog lacks, keeps the server message', () => {
    assert.equal(apiErrorText({ message: 'x' }), null);
    assert.equal(apiErrorText({ key: 'auth.session_invalid' }), null);
    assert.equal(apiErrorText(null), null);

    const response = { status: 409 };
    assert.equal(apiError(response, { error: { key: 'auth.session_invalid', message: 'Server text' } }).message, 'Server text');
    assert.equal(
        apiError(response, { error: { key: 'workflow.already_in_case', message: 'Server text' } }, '', { friendly: true }).message,
        'This toolkit is already available in this case.',
    );
});

test('every message the server sends for workflows has browser text', () => {
    for (const section of ['workflow', 'validation', 'owned_doc']) {
        const sent = keysOf(serverCatalog[section], `${section}.`).filter((key) => !key.startsWith('workflow.seed_'));
        const shown = new Set(keysOf(browserCatalog.api[section], `${section}.`));
        assert.deepEqual(sent.filter((key) => !shown.has(key)), [], `api.${section} is missing keys`);
    }
});
