import test from 'node:test';
import assert from 'node:assert/strict';
import { deepActiveElement } from '../../../dev/utils/focus.js';

test('finds the element that really has focus, through nested shadow roots', () => {
    const button = { name: 'the button' };
    const inner = { shadowRoot: { activeElement: button } };
    const outer = { shadowRoot: { activeElement: inner } };
    assert.equal(deepActiveElement({ activeElement: outer }), button);
});

test('returns the element itself when it has no shadow root, and null when nothing is focused', () => {
    const plain = { name: 'plain' };
    assert.equal(deepActiveElement({ activeElement: plain }), plain);
    assert.equal(deepActiveElement({ activeElement: null }), null);
});
