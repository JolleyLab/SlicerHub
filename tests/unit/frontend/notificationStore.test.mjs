import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { notificationStore } from '../../../dev/services/notificationStore.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const NONE = { count: 0, latestAt: null };

/** Stubs fetch by path; `seen` answers POST /api/notifications/seen. Records every path asked for. */
function stubFetch({ list = { notifications: [], unreadCount: 1, newCount: 1 }, seen = () => json({ ok: true }) } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const path = String(url);
        calls.push(path);
        if (path.endsWith('/api/notifications/seen')) return seen();
        if (path.includes('/api/notifications')) return typeof list === 'function' ? list() : json(list);
        return json(NONE); // to-do counts
    };
    return calls;
}

const seenPosts = (calls) => calls.filter((p) => p.endsWith('/api/notifications/seen')).length;
const dotLit = () => Boolean(notificationStore._state.newCount || notificationStore._state.newTodo);

describe('notificationStore.markSeen', () => {
    const realFetch = globalThis.fetch;

    beforeEach(async () => {
        stubFetch();
        await notificationStore.refresh({ quiet: true }); // one new notification: the dot is lit
        assert.equal(dotLit(), true);
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it('sends nothing and reports success when nothing is new', async () => {
        const calls = stubFetch({ list: { notifications: [], unreadCount: 0, newCount: 0 } });
        await notificationStore.refresh({ quiet: true });
        calls.length = 0;

        assert.equal(await notificationStore.markSeen(), true);
        assert.equal(calls.length, 0);
    });

    it('clears the dot and reports success when the save works', async () => {
        const calls = stubFetch();

        assert.equal(await notificationStore.markSeen(), true);
        assert.equal(seenPosts(calls), 1);
        assert.equal(dotLit(), false);
    });

    it('reports failure when the save fails, and the dot comes back on the next refresh', async () => {
        let release;
        const listed = new Promise((resolve) => { release = resolve; });
        let refreshed;
        const refreshDone = new Promise((resolve) => { refreshed = resolve; });
        stubFetch({
            seen: () => json({ error: { message: 'down' } }, 503),
            list: async () => { await listed; setTimeout(refreshed); return json({ notifications: [], unreadCount: 1, newCount: 1 }); }
        });

        assert.equal(await notificationStore.markSeen(), false);
        // Resolved before the failure's refresh lands, so the bell can stop retrying first.
        assert.equal(dotLit(), false);

        release();
        await refreshDone;
        assert.equal(dotLit(), true);
    });
});
