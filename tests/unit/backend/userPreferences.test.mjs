import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserPreferences, mergeUserPreferences, parseUserPreferencesJson } from '../../../backend/src/gpu/userPreferences.js';

test('preferences saved before the home layout existed still load, with the default layout', () => {
    const prefs = parseUserPreferencesJson(JSON.stringify({ theme: 'dark', useFullSlicer: true, useSimplifiedViewer: false }));
    assert.equal(prefs.theme, 'dark');
    assert.equal(prefs.useFullSlicer, true);
    assert.deepEqual(prefs.homeLayout.widgets, [
        { id: 'todo', column: 'main', hidden: false },
        { id: 'activity', column: 'main', hidden: false },
        { id: 'recent-cases', column: 'main', hidden: false }
    ]);
});

test('a saved home layout is cleaned: unknown widgets go, missing ones are added, junk cannot get in', () => {
    const prefs = normalizeUserPreferences({ homeLayout: { columns: 9, widgets: [{ id: 'activity', column: 'side', hidden: true }, { id: '<script>' }, { id: 'todo', column: 'elsewhere' }], extra: 'x' } });
    assert.deepEqual(prefs.homeLayout, {
        widgets: [
            { id: 'todo', column: 'main', hidden: false },
            { id: 'recent-cases', column: 'main', hidden: false },
            { id: 'activity', column: 'side', hidden: true }
        ]
    });
});

test('changing the theme keeps the saved layout, and saving a layout keeps the theme', () => {
    const withLayout = mergeUserPreferences({ theme: 'dark' }, { homeLayout: { widgets: [{ id: 'recent-cases', column: 'side' }] } });
    assert.equal(withLayout.theme, 'dark');
    assert.equal(withLayout.homeLayout.widgets.find((w) => w.id === 'recent-cases').column, 'side');
    const themeChanged = mergeUserPreferences(withLayout, { theme: 'light' });
    assert.equal(themeChanged.homeLayout.widgets.find((w) => w.id === 'recent-cases').column, 'side');
});

test('garbage stored as preferences falls back to defaults instead of failing', () => {
    for (const raw of ['not json', '{"homeLayout":', null, '']) {
        assert.equal(parseUserPreferencesJson(raw).homeLayout.widgets.length, 3);
    }
});
