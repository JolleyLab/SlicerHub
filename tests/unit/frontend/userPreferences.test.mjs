import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill browser globals used by theme.js and userPreferences.js.
// These run before tests execute (module body runs before test callbacks).
const mockStyle = { colorScheme: '', setProperty() {}, removeProperty() {} };
const _win = new EventTarget();
_win.matchMedia = () => ({ matches: false });
globalThis.window = _win;
globalThis.localStorage = { setItem() {}, getItem: () => null, removeItem() {} };
globalThis.document = { documentElement: { style: mockStyle, setAttribute() {}, getAttribute: () => null } };
globalThis.CSS = { registerProperty() {}, supports: () => false, escape: (s) => s };

import {
    normalizeUserPreferences,
    DEFAULT_USER_PREFERENCES,
    applyUserPreferences,
    getCachedUserPreferences,
    clearCachedUserPreferences
} from '../../../dev/utils/userPreferences.js';
import { DEFAULT_HOME_LAYOUT } from '../../../dev/utils/homeLayout.js';

describe('DEFAULT_USER_PREFERENCES', () => {
    it('has light theme', () => {
        assert.equal(DEFAULT_USER_PREFERENCES.theme, 'light');
    });

    it('has no full slicer by default', () => {
        assert.equal(DEFAULT_USER_PREFERENCES.useFullSlicer, false);
        assert.equal(DEFAULT_USER_PREFERENCES.useSimplifiedViewer, false);
    });

    it('defaults to stable channel', () => {
        assert.equal(DEFAULT_USER_PREFERENCES.slicerWebChannel, 'stable');
    });
});

describe('normalizeUserPreferences', () => {
    it('returns defaults for empty input', () => {
        const result = normalizeUserPreferences({});
        assert.equal(result.theme, 'light');
        assert.equal(result.useFullSlicer, false);
        assert.equal(result.useSimplifiedViewer, false);
        assert.equal(result.slicerWebChannel, 'stable');
    });

    it('accepts dark theme', () => {
        assert.equal(normalizeUserPreferences({ theme: 'dark' }).theme, 'dark');
    });

    it('rejects unknown theme values, falls back to light', () => {
        assert.equal(normalizeUserPreferences({ theme: 'solarized' }).theme, 'light');
        assert.equal(normalizeUserPreferences({ theme: null }).theme, 'light');
    });

    it('accepts slicerWebChannel latest', () => {
        assert.equal(normalizeUserPreferences({ slicerWebChannel: 'latest' }).slicerWebChannel, 'latest');
    });

    it('rejects unknown slicerWebChannel, falls back to stable', () => {
        assert.equal(normalizeUserPreferences({ slicerWebChannel: 'nightly' }).slicerWebChannel, 'stable');
        assert.equal(normalizeUserPreferences({ slicerWebChannel: null }).slicerWebChannel, 'stable');
    });

    it('passes useFullSlicer through normalization', () => {
        assert.equal(normalizeUserPreferences({ useFullSlicer: true }).useFullSlicer, true);
        assert.equal(normalizeUserPreferences({ useFullSlicer: false }).useFullSlicer, false);
    });

    it('clears useSimplifiedViewer when useFullSlicer is false', () => {
        const result = normalizeUserPreferences({ useFullSlicer: false, useSimplifiedViewer: true });
        assert.equal(result.useSimplifiedViewer, false);
    });

    it('allows useSimplifiedViewer when useFullSlicer is true', () => {
        const result = normalizeUserPreferences({ useFullSlicer: true, useSimplifiedViewer: true });
        assert.equal(result.useFullSlicer, true);
        assert.equal(result.useSimplifiedViewer, true);
    });

    it('includes homeLayout in normalized output', () => {
        const result = normalizeUserPreferences({});
        assert.ok(result.homeLayout);
        assert.ok(Array.isArray(result.homeLayout.widgets));
    });

    it('normalizes homeLayout from input', () => {
        const layout = { widgets: [{ id: 'todo', column: 'side', hidden: false }] };
        const result = normalizeUserPreferences({ homeLayout: layout });
        const todoWidget = result.homeLayout.widgets.find(w => w.id === 'todo');
        assert.equal(todoWidget?.column, 'side');
    });
});

describe('getCachedUserPreferences / applyUserPreferences / clearCachedUserPreferences', () => {
    beforeEach(() => {
        clearCachedUserPreferences();
    });

    it('returns defaults before any preferences are applied', () => {
        const prefs = getCachedUserPreferences();
        assert.equal(prefs.theme, 'light');
        assert.equal(prefs.useFullSlicer, false);
        assert.equal(prefs.slicerWebChannel, 'stable');
    });

    it('applyUserPreferences updates the cache', () => {
        applyUserPreferences({ theme: 'dark', useFullSlicer: true, slicerWebChannel: 'latest' });
        const prefs = getCachedUserPreferences();
        assert.equal(prefs.theme, 'dark');
        assert.equal(prefs.useFullSlicer, true);
        assert.equal(prefs.slicerWebChannel, 'latest');
    });

    it('applyUserPreferences normalizes values before caching', () => {
        applyUserPreferences({ theme: 'invalid', slicerWebChannel: 'unknown' });
        const prefs = getCachedUserPreferences();
        assert.equal(prefs.theme, 'light');
        assert.equal(prefs.slicerWebChannel, 'stable');
    });

    it('clearCachedUserPreferences resets to defaults', () => {
        applyUserPreferences({ theme: 'dark' });
        clearCachedUserPreferences();
        assert.equal(getCachedUserPreferences().theme, 'light');
    });

    it('getCachedUserPreferences returns a copy, not a reference', () => {
        const a = getCachedUserPreferences();
        const b = getCachedUserPreferences();
        assert.notEqual(a, b);
        a.theme = 'dark';
        assert.equal(getCachedUserPreferences().theme, 'light');
    });
});
