import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadStoredSet, saveStoredSet, toggledSet } from '../../../dev/utils/storedSet.js';

/** A localStorage stand-in; `failing` makes every call throw, as in private mode or over quota. */
function fakeStorage({ failing = false } = {}) {
    const data = new Map();
    const guard = () => { if (failing) throw new Error('storage unavailable'); };
    return {
        getItem: (key) => { guard(); return data.has(key) ? data.get(key) : null; },
        setItem: (key, value) => { guard(); data.set(key, String(value)); },
        removeItem: (key) => { guard(); data.delete(key); },
    };
}

describe('stored sets (e.g. folded Home sections)', () => {
    beforeEach(() => { globalThis.localStorage = fakeStorage(); });

    it('start from the fallback when nothing is saved', () => {
        assert.deepEqual([...loadStoredSet('k', ['a', 'b'])], ['a', 'b']);
    });

    it('read back what was saved, including an empty set (all open)', () => {
        saveStoredSet('k', new Set(['b']));
        assert.deepEqual([...loadStoredSet('k', ['a'])], ['b']);
        saveStoredSet('k', new Set());
        assert.deepEqual([...loadStoredSet('k', ['a'])], []);
    });

    it('fall back on a saved value that is not a list', () => {
        localStorage.setItem('k', '{"a":1}');
        assert.deepEqual([...loadStoredSet('k', ['x'])], ['x']);
        localStorage.setItem('k', 'not json');
        assert.deepEqual([...loadStoredSet('k', ['x'])], ['x']);
    });

    it('work without storage: load gives the fallback and save does not throw', () => {
        globalThis.localStorage = fakeStorage({ failing: true });
        assert.deepEqual([...loadStoredSet('k', ['x'])], ['x']);
        assert.doesNotThrow(() => saveStoredSet('k', new Set(['y'])));
    });

    it('toggle an id into or out of a copy, leaving the original alone', () => {
        const ids = new Set(['a']);
        assert.deepEqual([...toggledSet(ids, 'b')], ['a', 'b']);
        assert.deepEqual([...toggledSet(ids, 'a')], []);
        assert.deepEqual([...ids], ['a']);
    });
});
