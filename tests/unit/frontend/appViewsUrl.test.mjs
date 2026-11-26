import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser URL + history over one mutable location.
const calls = [];
globalThis.window = { location: { href: 'http://x.test/' } };
globalThis.history = {
    pushState: (_s, _t, url) => { calls.push(['push', url]); window.location.href = new URL(url, 'http://x.test').href; },
    replaceState: (_s, _t, url) => { calls.push(['replace', url]); window.location.href = new URL(url, 'http://x.test').href; },
};
const go = (path) => { window.location.href = `http://x.test${path}`; calls.length = 0; };

const { APP_VIEWS, writeAppViewToUrl, updateUrlParams } = await import('../../../dev/components/app-views.js');

test('updateUrlParams sets and removes params, pushing a history entry', () => {
    go('/?view=workflows');
    updateUrlParams({ workflow: 12 });
    assert.deepEqual(calls, [['push', '/?view=workflows&workflow=12']]);
    updateUrlParams({ workflow: null, tab: 'all' }, { replace: true });
    assert.deepEqual(calls[1], ['replace', '/?view=workflows&tab=all']);
});

test('updateUrlParams does nothing when the URL would not change', () => {
    go('/?view=workflows&workflow=12');
    updateUrlParams({ workflow: '12', tab: null });
    assert.deepEqual(calls, []);
});

test('leaving a view drops its deep link; staying keeps it unless clearDeepLink', () => {
    go('/?view=workflows&workflow=12&tab=all&share=abc');
    writeAppViewToUrl({ currentView: APP_VIEWS.WORKFLOWS });
    assert.equal(calls.at(-1)[1], '/?view=workflows&workflow=12&tab=all&share=abc');

    writeAppViewToUrl({ currentView: APP_VIEWS.MY_GROUPS });
    assert.equal(calls.at(-1)[1], '/?view=my-groups&share=abc');

    go('/?view=cases&case=5&viewer=1');
    writeAppViewToUrl({ currentView: APP_VIEWS.CASES, clearDeepLink: true });
    assert.equal(calls.at(-1)[1], '/?view=cases');
});
