import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearSlicerWebStorage, claimSlicerWebStorage } from '../../../dev/utils/slicerWebStorage.js';

function fakeStorage(entries = {}) {
    const map = new Map(Object.entries(entries));
    return {
        get length() { return map.size; },
        key: (i) => [...map.keys()][i] ?? null,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        keys: () => [...map.keys()].sort(),
    };
}

function fakeIdb(names, { block = [] } = {}) {
    const deleted = [];
    return {
        deleted,
        databases: async () => names.map((name) => ({ name })),
        deleteDatabase(name) {
            deleted.push(name);
            const req = {};
            queueMicrotask(() => (block.includes(name) ? req.onblocked() : req.onsuccess()));
            return req;
        },
    };
}

const SLICERWEB_STATE = {
    'slicerweb.extensions': '["https://example.com/x.whl"]',
    'slicerweb.extensionIndex': 'https://example.com/index.json',
    'slicerweb.settings': '{}',
    'ui-theme': 'dark',
};
const DBS = ['/home/pyodide/SlicerData', '/home/pyodide/SlicerSessions/abc', 'other-app-db'];

describe('clearSlicerWebStorage', () => {
    it('removes slicerweb.* keys and Pyodide databases, keeps everything else', async () => {
        const storage = fakeStorage(SLICERWEB_STATE);
        const idb = fakeIdb(DBS);
        await clearSlicerWebStorage({ storage, idb });
        assert.deepEqual(storage.keys(), ['ui-theme']);
        assert.deepEqual(idb.deleted, DBS.slice(0, 2));
    });

    it('finishes when a database is blocked by an open SlicerWeb tab', async () => {
        const idb = fakeIdb(DBS, { block: [DBS[0]] });
        await clearSlicerWebStorage({ storage: fakeStorage(), idb });
        assert.equal(idb.deleted.length, 2);
    });

    it('gives up after the timeout and never throws', async () => {
        const idb = { databases: () => new Promise(() => {}) };
        const storage = { get length() { throw new Error('blocked'); } };
        await clearSlicerWebStorage({ storage, idb, timeoutMs: 10 });
    });

    it('works without indexedDB.databases()', async () => {
        const storage = fakeStorage(SLICERWEB_STATE);
        await clearSlicerWebStorage({ storage, idb: {} });
        assert.deepEqual(storage.keys(), ['ui-theme']);
    });
});

describe('claimSlicerWebStorage', () => {
    it('clears state left by another user and records the new owner', async () => {
        const storage = fakeStorage({ ...SLICERWEB_STATE, 'sh-slicerweb-owner': '1' });
        const idb = fakeIdb(DBS);
        await claimSlicerWebStorage(2, { storage, idb });
        assert.deepEqual(storage.keys(), ['sh-slicerweb-owner', 'ui-theme']);
        assert.equal(storage.getItem('sh-slicerweb-owner'), '2');
        assert.equal(idb.deleted.length, 2);
    });

    it('clears unowned state from before the marker existed', async () => {
        const storage = fakeStorage(SLICERWEB_STATE);
        await claimSlicerWebStorage('7', { storage, idb: fakeIdb([]) });
        assert.equal(storage.getItem('slicerweb.extensions'), null);
        assert.equal(storage.getItem('sh-slicerweb-owner'), '7');
    });

    it('keeps state when the same user signs in again', async () => {
        const storage = fakeStorage({ ...SLICERWEB_STATE, 'sh-slicerweb-owner': '7' });
        const idb = fakeIdb(DBS);
        await claimSlicerWebStorage(7, { storage, idb });
        assert.ok(storage.getItem('slicerweb.extensions'));
        assert.deepEqual(idb.deleted, []);
    });

    it('does nothing without a user id', async () => {
        const storage = fakeStorage(SLICERWEB_STATE);
        await claimSlicerWebStorage(null, { storage, idb: fakeIdb(DBS) });
        assert.ok(storage.getItem('slicerweb.extensions'));
    });
});
