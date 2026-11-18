import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// lit-element needs a browser; the list's logic doesn't, so its templates are stubbed.
mock.module(new URL('../../../dev/node_modules/lit-element/lit-element.js', import.meta.url).href, {
    namedExports: { html: () => '', css: () => '' },
});

const { PagedList } = await import('../../../dev/utils/pagedList.js');

/** A fetchPage whose replies the test releases, in any order. */
function server() {
    const pending = [];
    const fetchPage = (params) => new Promise((resolve, reject) => pending.push({ params, resolve, reject }));
    return { fetchPage, pending };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('PagedList', () => {
    let srv;
    let list;
    beforeEach(() => {
        srv = server();
        list = new PagedList(srv.fetchPage, () => {});
    });

    it('loads the first page, then adds the next on more()', async () => {
        list.search({ q: 'heart', sort: 'newest' });
        assert.deepEqual(srv.pending[0].params, { q: 'heart', sort: 'newest', page: 1 });
        srv.pending[0].resolve({ items: [1, 2], hasMore: true });
        await tick();
        assert.deepEqual([list.items, list.hasMore, list.loading], [[1, 2], true, false]);

        list.more();
        assert.deepEqual(srv.pending[1].params, { q: 'heart', sort: 'newest', page: 2 });
        srv.pending[1].resolve({ items: [3], hasMore: false });
        await tick();
        assert.deepEqual([list.items, list.hasMore], [[1, 2, 3], false]);
        await list.more(); // nothing more to load
        assert.equal(srv.pending.length, 2);
    });

    it('keeps only the latest search: a slow reply to an older one is dropped', async () => {
        list.search({ q: 'old' });
        list.search({ q: 'new' });
        srv.pending[1].resolve({ items: ['new'], hasMore: false });
        await tick();
        srv.pending[0].resolve({ items: ['old'], hasMore: true });
        await tick();
        assert.deepEqual([list.items, list.hasMore], [['new'], false]);
    });

    it('keeps what is shown when a load fails, and says so', async () => {
        list.search({});
        srv.pending[0].resolve({ items: [1], hasMore: true });
        await tick();
        list.more();
        srv.pending[1].reject(new Error('offline'));
        await tick();
        assert.deepEqual([list.items, list.error?.message, list.loading], [[1], 'offline', false]);
    });
});
