import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasNewTodo, toBellCount, NO_TODOS } from '../../../dev/utils/bellCount.js';

const OPENED = '2026-11-18T12:00:00.000Z';
const todo = (latestAt, count = 1) => ({ count, latestAt });

describe('the bell dot for to-dos', () => {
    it('lights only for a to-do that arrived after the bell was last opened', () => {
        assert.equal(hasNewTodo([todo('2026-11-18T11:00:00.000Z')], OPENED), false);
        assert.equal(hasNewTodo([todo('2026-11-18T11:00:00.000Z'), todo('2026-11-18T13:00:00.000Z')], OPENED), true);
    });

    it('lights for any to-do if the bell was never opened, and never for none waiting', () => {
        assert.equal(hasNewTodo([todo('2026-11-18T11:00:00.000Z')], null), true);
        assert.equal(hasNewTodo([NO_TODOS, todo('2026-11-18T13:00:00.000Z', 0)], null), false);
    });

    it('reads a count response, treating anything unusable as none', () => {
        assert.deepEqual(toBellCount({ count: 2, latestAt: OPENED }), { count: 2, latestAt: OPENED });
        assert.deepEqual(toBellCount(null), NO_TODOS);
        assert.deepEqual(toBellCount({ count: 'x' }), NO_TODOS);
    });
});
