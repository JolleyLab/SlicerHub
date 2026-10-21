import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../../../dev/i18n/index.js';

// ── i18n catalog keys ─────────────────────────────────────────────────────────

test('all edit-conflict i18n keys exist in the frontend catalog', () => {
    const keys = [
        'errors.editConflictTitle',
        'errors.editConflictMessage',
        'files.saveConflictAsNew',
        'files.discardConflictChanges',
    ];
    for (const key of keys) {
        assert.notEqual(t(key), key, `missing i18n key: ${key}`);
    }
});

test('editConflictTitle contains no retry language', () => {
    const title = t('errors.editConflictTitle');
    for (const phrase of ['try again', 'retry', 'reconnect']) {
        assert.ok(!title.toLowerCase().includes(phrase), `title should not say "${phrase}"`);
    }
});

test('editConflictMessage mentions saving as a new file or discarding', () => {
    const msg = t('errors.editConflictMessage').toLowerCase();
    assert.ok(
        msg.includes('new') || msg.includes('discard') || msg.includes('someone else'),
        'message should describe the conflict and the two choices'
    );
});
