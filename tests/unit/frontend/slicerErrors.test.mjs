import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySlicerLoadError } from '../../../dev/services/slicerErrors.js';
import { t } from '../../../dev/i18n/index.js';

// ── i18n catalog ──────────────────────────────────────────────────────────────

test('all slicer load error i18n keys exist in the catalog', () => {
    const keys = [
        'errors.slicerLoadFailedTitle',
        'errors.slicerLoadFailedTransientTitle',
        'errors.slicerLoadFailed',
        'errors.slicerLoadFailedFormat',
        'errors.slicerLoadFailedTransient',
    ];
    for (const key of keys) {
        assert.notEqual(t(key), key, `missing i18n key: ${key}`);
    }
});

// ── format errors (no retry language) ─────────────────────────────────────────

test('format keywords map to the "not supported" title and format message', () => {
    const formatTitle = t('errors.slicerLoadFailedTitle');
    const formatMsg   = t('errors.slicerLoadFailedFormat');
    const cases = [
        'load failed',
        'unsupported file',
        'format not supported',
        'no reader for this file',
        'unrecognized extension',
        'unable to load the file',
        'unable to read data',
        'cannot read volume',
        "can't read this",
        'invalid format',
        'failed to load node',
        'createnodebyclass failed',
        // mixed case should still match
        'Load Failed: bad extension',
        'UNSUPPORTED FORMAT',
    ];
    for (const raw of cases) {
        const result = classifySlicerLoadError(raw);
        assert.equal(result.title,   formatTitle, `title wrong for: "${raw}"`);
        assert.equal(result.message, formatMsg,   `message wrong for: "${raw}"`);
    }
});

test('format error title contains no retry language', () => {
    const { title, message } = classifySlicerLoadError('load failed');
    for (const phrase of ['try again', 'retry', 'few minutes']) {
        assert.ok(!title.toLowerCase().includes(phrase),   `title should not say "${phrase}"`);
        assert.ok(!message.toLowerCase().includes(phrase), `message should not say "${phrase}"`);
    }
});

// ── transient errors (retry encouraged) ───────────────────────────────────────

test('transient keywords map to the "something went wrong" title and transient message', () => {
    const transientTitle = t('errors.slicerLoadFailedTransientTitle');
    const transientMsg   = t('errors.slicerLoadFailedTransient');
    const cases = [
        'timeout waiting for response',
        'request timed out',
        'connection refused',
        'network error',
        'crash detected',
        'process was killed',
        'out of memory',
        'NETWORK ERROR',   // case-insensitive
        'Connection reset',
    ];
    for (const raw of cases) {
        const result = classifySlicerLoadError(raw);
        assert.equal(result.title,   transientTitle, `title wrong for: "${raw}"`);
        assert.equal(result.message, transientMsg,   `message wrong for: "${raw}"`);
    }
});

// ── unknown / generic errors ──────────────────────────────────────────────────

test('unknown error falls back to the generic title and fallback message', () => {
    const genericTitle = t('errors.slicerLoadFailedTitle');
    const genericMsg   = t('errors.slicerLoadFailed');
    for (const raw of ['Something bad happened', 'exit code 1', 'unknown error', '']) {
        const result = classifySlicerLoadError(raw);
        assert.equal(result.title,   genericTitle, `title wrong for: "${raw}"`);
        assert.equal(result.message, genericMsg,   `message wrong for: "${raw}"`);
    }
});

test('null and undefined are treated as empty and return the generic fallback', () => {
    const genericMsg = t('errors.slicerLoadFailed');
    assert.equal(classifySlicerLoadError(null).message,      genericMsg);
    assert.equal(classifySlicerLoadError(undefined).message, genericMsg);
});

// ── format takes priority over transient when both keywords present ────────────

test('format keyword wins when message contains both format and transient keywords', () => {
    const formatTitle = t('errors.slicerLoadFailedTitle');
    // "load failed" (format) + "timeout" (transient) in the same string
    const result = classifySlicerLoadError('load failed after connection timeout');
    assert.equal(result.title, formatTitle);
});
