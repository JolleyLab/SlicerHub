import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '../../../backend/src/utils/errors.js';

const { msg } = await import('../../../backend/src/i18n/index.js');

// ── ConflictError shape ───────────────────────────────────────────────────────

test('ConflictError has statusCode 409', () => {
    assert.equal(new ConflictError('x').statusCode, 409);
});

test('ConflictError carries the code it was given', () => {
    const err = new ConflictError('msg', 'EDIT_CONFLICT', 'case.edit_conflict');
    assert.equal(err.code, 'EDIT_CONFLICT');
    assert.equal(err.messageKey, 'case.edit_conflict');
});

test('ConflictError is an operational error', () => {
    assert.equal(new ConflictError('x').isOperational, true);
});

// ── backend i18n key ─────────────────────────────────────────────────────────

test('case.edit_conflict message key exists in the backend catalog', () => {
    const text = msg('case.edit_conflict');
    assert.notEqual(text, 'case.edit_conflict', 'key is missing from the backend catalog');
    assert.ok(text.length > 0, 'message should not be empty');
});
