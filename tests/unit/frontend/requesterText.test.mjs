import test from 'node:test';
import assert from 'node:assert/strict';
import { requesterText } from '../../../dev/utils/activityItems.js';

test('requester names read as one line, however many asked', () => {
    assert.equal(requesterText(['Ana']), 'Ana');
    assert.equal(requesterText(['Ana', 'Ben']), 'Ana and Ben');
    assert.equal(requesterText(['Ana', 'Ben', 'Cy']), 'Ana and 2 others');
    assert.equal(requesterText([null, 'Ben']), 'someone and Ben');
    assert.equal(requesterText([null], 'Someone'), 'Someone'); // at the start of a sentence
});
