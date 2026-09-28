import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HOME_WIDGETS,
    HOME_PRESETS,
    DEFAULT_HOME_LAYOUT,
    normalizeHomeLayout,
    matchPreset,
    presetLayout,
    moveWidget,
    moveToColumn,
    placeWidget,
    setWidgetHidden,
    widgetsInColumn,
    visibleColumns
} from '../../../dev/utils/homeLayout.js';
import { normalizeHomeLayout as normalizeOnServer, KNOWN_WIDGET_IDS } from '../../../backend/src/utils/homeLayout.js';

const IDS = HOME_WIDGETS.map((w) => w.id);
const placed = (layout) => layout.widgets.map((w) => `${w.id}:${w.column}${w.hidden ? ':hidden' : ''}`);
const ids = (widgets) => widgets.map((w) => w.id);

test('nothing saved gives the default layout: every widget, in the main column, none hidden', () => {
    for (const nothing of [undefined, null, {}, 'x', 5, { widgets: 'no' }]) {
        assert.deepEqual(placed(normalizeHomeLayout(nothing)), ['todo:main', 'activity:main', 'recent-cases:main']);
    }
});

test('a saved placement, order and hidden state are kept', () => {
    const layout = normalizeHomeLayout({ widgets: [
        { id: 'activity', column: 'side' }, { id: 'todo', column: 'main' }, { id: 'recent-cases', column: 'main', hidden: true }
    ] });
    assert.deepEqual(placed(layout), ['todo:main', 'recent-cases:main:hidden', 'activity:side']);
});

test('the layout is stored main column first, then side, each in its own order', () => {
    const layout = normalizeHomeLayout({ widgets: [
        { id: 'recent-cases', column: 'side' }, { id: 'activity', column: 'main' }, { id: 'todo', column: 'side' }
    ] });
    assert.deepEqual(placed(layout), ['activity:main', 'recent-cases:side', 'todo:side']);
});

test('unknown ids and duplicates are dropped, and unmentioned widgets join the main column', () => {
    const layout = normalizeHomeLayout({ widgets: [{ id: 'weather' }, { id: 'activity', column: 'side' }, { id: 'activity', hidden: true }, null, 'todo'] });
    assert.deepEqual(placed(layout), ['todo:main', 'recent-cases:main', 'activity:side']);
});

test('a column is main unless it is exactly "side", and hidden is true only for exactly true', () => {
    const layout = normalizeHomeLayout({ widgets: [
        { id: 'todo', column: 'left', hidden: 'yes' }, { id: 'activity', column: 'SIDE', hidden: 1 }, { id: 'recent-cases', column: 'side', hidden: true }
    ] });
    assert.deepEqual(placed(layout), ['todo:main', 'activity:main', 'recent-cases:side:hidden']);
});

test('a layout saved with the old "columns" field still loads, and the field is dropped', () => {
    const layout = normalizeHomeLayout({ columns: 2, widgets: [{ id: 'activity', hidden: true }, { id: 'todo' }] });
    assert.equal('columns' in layout, false);
    assert.deepEqual(placed(layout), ['activity:main:hidden', 'todo:main', 'recent-cases:main']);
});

test('an enormous saved list cannot make the layout huge', () => {
    const layout = normalizeHomeLayout({ widgets: Array.from({ length: 5000 }, (_, i) => ({ id: `w${i}` })) });
    assert.deepEqual(ids(layout.widgets), IDS);
});

test('every preset is a valid layout and is recognised as itself; the default is the first', () => {
    for (const preset of HOME_PRESETS) {
        assert.deepEqual(normalizeHomeLayout(preset.layout), presetLayout(preset.id));
        assert.equal(matchPreset(preset.layout), preset.id);
    }
    assert.equal(matchPreset(DEFAULT_HOME_LAYOUT), 'default');
    assert.equal(HOME_PRESETS[0].id, 'default');
});

test('presets differ from each other, so each is chosen by exactly one layout', () => {
    const keys = HOME_PRESETS.map((p) => JSON.stringify(normalizeHomeLayout(p.layout)));
    assert.equal(new Set(keys).size, keys.length);
});

test('a layout that matches no preset is custom, and unknown preset ids have no layout', () => {
    assert.equal(matchPreset(setWidgetHidden(DEFAULT_HOME_LAYOUT, 'activity', true)), 'custom');
    assert.equal(matchPreset(moveWidget(DEFAULT_HOME_LAYOUT, 'todo', 1)), 'custom');
    assert.equal(matchPreset(moveToColumn(DEFAULT_HOME_LAYOUT, 'activity', 'side')), 'balanced', 'building a preset by hand is that preset')
    assert.equal(presetLayout('nope'), null);
});

test('moving swaps a widget with its neighbour in the same column, and does nothing at the ends', () => {
    assert.deepEqual(ids(widgetsInColumn(moveWidget(DEFAULT_HOME_LAYOUT, 'todo', 1), 'main')), ['activity', 'todo', 'recent-cases']);
    assert.deepEqual(ids(widgetsInColumn(moveWidget(DEFAULT_HOME_LAYOUT, 'recent-cases', -1), 'main')), ['todo', 'recent-cases', 'activity']);
    assert.deepEqual(placed(moveWidget(DEFAULT_HOME_LAYOUT, 'todo', -1)), placed(DEFAULT_HOME_LAYOUT), 'first cannot go up');
    assert.deepEqual(placed(moveWidget(DEFAULT_HOME_LAYOUT, 'recent-cases', 1)), placed(DEFAULT_HOME_LAYOUT), 'last cannot go down');
    assert.deepEqual(placed(moveWidget(DEFAULT_HOME_LAYOUT, 'nope', 1)), placed(DEFAULT_HOME_LAYOUT), 'unknown id');
});

test('moving only reorders within its own column; the other column is untouched', () => {
    const start = presetLayout('balanced'); // main: todo, recent-cases; side: activity
    assert.deepEqual(placed(moveWidget(start, 'activity', 1)), placed(start), 'alone in its column');
    assert.deepEqual(placed(moveWidget(start, 'activity', -1)), placed(start));
    assert.deepEqual(placed(moveWidget(start, 'todo', 1)), ['recent-cases:main', 'todo:main', 'activity:side']);
});

test('moving keeps hidden state and does not change the layout it was given', () => {
    const start = setWidgetHidden(DEFAULT_HOME_LAYOUT, 'todo', true);
    const before = JSON.stringify(start);
    const moved = moveWidget(start, 'todo', 1);
    assert.equal(moved.widgets.find((w) => w.id === 'todo').hidden, true);
    assert.equal(JSON.stringify(start), before);
});

test('moving to the other column puts the widget at the bottom of it', () => {
    const toSide = moveToColumn(DEFAULT_HOME_LAYOUT, 'activity', 'side');
    assert.deepEqual(placed(toSide), ['todo:main', 'recent-cases:main', 'activity:side']);
    const two = moveToColumn(toSide, 'todo', 'side');
    assert.deepEqual(placed(two), ['recent-cases:main', 'activity:side', 'todo:side']);
    assert.deepEqual(placed(moveToColumn(two, 'todo', 'main')), ['recent-cases:main', 'todo:main', 'activity:side']);
    assert.deepEqual(placed(moveToColumn(DEFAULT_HOME_LAYOUT, 'todo', 'nowhere')), placed(DEFAULT_HOME_LAYOUT));
    assert.deepEqual(placed(moveToColumn(DEFAULT_HOME_LAYOUT, 'nope', 'side')), placed(DEFAULT_HOME_LAYOUT));
});

test('dropping a widget places it at a position in a column, including an empty one', () => {
    const start = presetLayout('default'); // main: todo, activity, recent-cases
    assert.deepEqual(placed(placeWidget(start, 'recent-cases', 'main', 0)), ['recent-cases:main', 'todo:main', 'activity:main']);
    assert.deepEqual(placed(placeWidget(start, 'todo', 'main', 1)), ['activity:main', 'todo:main', 'recent-cases:main']);
    assert.deepEqual(placed(placeWidget(start, 'todo', 'main', 2)), ['activity:main', 'recent-cases:main', 'todo:main']);
    assert.deepEqual(placed(placeWidget(start, 'activity', 'side', 0)), ['todo:main', 'recent-cases:main', 'activity:side'], 'into an empty column');
    const balanced = presetLayout('balanced'); // main: todo, recent-cases; side: activity
    assert.deepEqual(placed(placeWidget(balanced, 'recent-cases', 'side', 0)), ['todo:main', 'recent-cases:side', 'activity:side']);
    assert.deepEqual(placed(placeWidget(balanced, 'todo', 'side', 1)), ['recent-cases:main', 'activity:side', 'todo:side']);
});

test('dropping where the widget already is changes nothing, and hidden state travels with it', () => {
    const start = presetLayout('balanced');
    assert.deepEqual(placed(placeWidget(start, 'todo', 'main', 0)), placed(start));
    assert.deepEqual(placed(placeWidget(start, 'recent-cases', 'main', 1)), placed(start));
    const hidden = setWidgetHidden(start, 'todo', true);
    assert.equal(placeWidget(hidden, 'todo', 'side', 0).widgets.find((w) => w.id === 'todo').hidden, true);
});

test('a drop with a bad id, column or index is safe', () => {
    const start = presetLayout('balanced');
    assert.deepEqual(placed(placeWidget(start, 'nope', 'side', 0)), placed(start));
    assert.deepEqual(placed(placeWidget(start, 'todo', 'left', 0)), placed(start));
    assert.deepEqual(placed(placeWidget(start, 'todo', 'side', 99)), ['recent-cases:main', 'activity:side', 'todo:side'], 'past the end is the bottom');
    assert.deepEqual(placed(placeWidget(start, 'todo', 'side', -3)), ['recent-cases:main', 'todo:side', 'activity:side'], 'before the start is the top');
    assert.deepEqual(placed(placeWidget(start, 'todo', 'side', undefined)), ['recent-cases:main', 'activity:side', 'todo:side']);
});

test('a drop never loses or duplicates a widget', () => {
    let layout = presetLayout('default');
    for (const [id, column, index] of [['todo', 'side', 0], ['activity', 'side', 1], ['recent-cases', 'side', 0], ['todo', 'main', 0], ['activity', 'main', 5]]) {
        layout = placeWidget(layout, id, column, index);
        assert.deepEqual(layout.widgets.map((w) => w.id).sort(), [...IDS].sort());
    }
});

test('hiding a widget removes it from what Home renders, and showing it brings it back in place', () => {
    const hidden = setWidgetHidden(presetLayout('balanced'), 'todo', true);
    assert.deepEqual({ main: ids(visibleColumns(hidden).main), side: ids(visibleColumns(hidden).side) }, { main: ['recent-cases'], side: ['activity'] });
    const shown = setWidgetHidden(hidden, 'todo', false);
    assert.deepEqual(ids(visibleColumns(shown).main), ['todo', 'recent-cases']);
});

test('hiding everything leaves nothing to show in either column', () => {
    let layout = DEFAULT_HOME_LAYOUT;
    for (const id of IDS) layout = setWidgetHidden(layout, id, true);
    assert.deepEqual(visibleColumns(layout), { main: [], side: [] });
});

test('the server allowlist and the browser registry list the same widgets, and normalise the same way', () => {
    assert.deepEqual([...KNOWN_WIDGET_IDS], IDS);
    const samples = [
        null,
        { columns: 2, widgets: [{ id: 'activity', column: 'side', hidden: true }, { id: 'x' }] },
        { widgets: [{ id: 'recent-cases', column: 'side' }, { id: 'todo', column: 'weird' }] }
    ];
    for (const sample of samples) assert.deepEqual(normalizeOnServer(sample), normalizeHomeLayout(sample));
});
