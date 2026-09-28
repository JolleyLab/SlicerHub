/**
 * The Home page layout: a wide (2/3) main column and a narrow (1/3) side column, each holding some of
 * the widgets in order, and any widget can be hidden. Saved per user in their preferences as
 * { widgets: [{ id, column: 'main' | 'side', hidden }] }. With nothing visible in the side column, the
 * main column takes the full width.
 *
 * Forward compatible: an id this version does not know is dropped, and a widget the saved layout does
 * not mention is added to the main column, so adding a widget never breaks a saved layout. An older
 * saved layout with a `columns` field is read without it.
 * The backend keeps its own allowlist of ids (backend/src/utils/homeLayout.js); a test keeps them equal.
 */

export const COLUMNS = Object.freeze(['main', 'side']);

/** Every widget, in default order. */
export const HOME_WIDGETS = Object.freeze([
    { id: 'todo', titleKey: 'home.todo.title' },
    { id: 'activity', titleKey: 'home.activity.title' },
    { id: 'recent-cases', titleKey: 'home.recentCases' }
]);

const KNOWN_IDS = HOME_WIDGETS.map((widget) => widget.id);

const place = (main, side = [], hidden = []) => ({
    widgets: [
        ...main.map((id) => ({ id, column: 'main', hidden: hidden.includes(id) })),
        ...side.map((id) => ({ id, column: 'side', hidden: hidden.includes(id) }))
    ]
});

export const HOME_PRESETS = Object.freeze([
    { id: 'default', labelKey: 'homeLayout.presetDefault', layout: place(['todo', 'activity', 'recent-cases']) },
    { id: 'balanced', labelKey: 'homeLayout.presetBalanced', layout: place(['todo', 'recent-cases'], ['activity']) },
    { id: 'cases-first', labelKey: 'homeLayout.presetCasesFirst', layout: place(['recent-cases'], ['todo', 'activity']) },
    { id: 'todo-only', labelKey: 'homeLayout.presetTodoOnly', layout: place(['todo', 'activity', 'recent-cases'], [], ['activity', 'recent-cases']) }
]);

/** A layout in canonical form, from whatever was saved. Never throws. */
export function normalizeHomeLayout(input) {
    const saved = Array.isArray(input?.widgets) ? input.widgets.slice(0, 50) : [];
    const seen = new Set();
    const widgets = [];
    for (const entry of saved) {
        const id = entry && typeof entry === 'object' ? entry.id : null;
        if (!KNOWN_IDS.includes(id) || seen.has(id)) continue;
        seen.add(id);
        widgets.push({ id, column: entry.column === 'side' ? 'side' : 'main', hidden: entry.hidden === true });
    }
    for (const id of KNOWN_IDS) {
        if (!seen.has(id)) widgets.push({ id, column: 'main', hidden: false });
    }
    // Canonical order: the main column's widgets, then the side column's, each in its own order.
    return { widgets: [...widgets.filter((w) => w.column === 'main'), ...widgets.filter((w) => w.column === 'side')] };
}

export const DEFAULT_HOME_LAYOUT = normalizeHomeLayout(HOME_PRESETS[0].layout);

/** The id of the preset a layout equals, or "custom". */
export function matchPreset(layout) {
    const current = JSON.stringify(normalizeHomeLayout(layout));
    const preset = HOME_PRESETS.find((entry) => JSON.stringify(normalizeHomeLayout(entry.layout)) === current);
    return preset ? preset.id : 'custom';
}

export function presetLayout(presetId) {
    const preset = HOME_PRESETS.find((entry) => entry.id === presetId);
    return preset ? normalizeHomeLayout(preset.layout) : null;
}

/** The widgets of one column, in order, hidden ones included. */
export function widgetsInColumn(layout, column) {
    return normalizeHomeLayout(layout).widgets.filter((widget) => widget.column === column);
}

/** Move a widget one place up (-1) or down (+1) within its column; unchanged at either end. */
export function moveWidget(layout, id, delta) {
    const normalized = normalizeHomeLayout(layout);
    const from = normalized.widgets.findIndex((widget) => widget.id === id);
    if (from < 0) return normalized;
    const column = normalized.widgets[from].column;
    const inColumn = normalized.widgets.map((widget, index) => (widget.column === column ? index : -1)).filter((index) => index >= 0);
    const target = inColumn.indexOf(from) + delta;
    if (target < 0 || target >= inColumn.length) return normalized;
    const widgets = normalized.widgets.slice();
    [widgets[from], widgets[inColumn[target]]] = [widgets[inColumn[target]], widgets[from]];
    return normalizeHomeLayout({ widgets });
}

/** Put a widget at the bottom of the given column. */
export function moveToColumn(layout, id, column) {
    const normalized = normalizeHomeLayout(layout);
    const widget = normalized.widgets.find((entry) => entry.id === id);
    if (!widget || !COLUMNS.includes(column)) return normalized;
    return normalizeHomeLayout({
        widgets: [...normalized.widgets.filter((entry) => entry.id !== id), { ...widget, column }]
    });
}

/**
 * Drop a widget into a column at a position (0 = top), as after a drag. The index counts the column's
 * widgets as listed, hidden ones included, and an index past the end means the bottom.
 */
export function placeWidget(layout, id, column, index) {
    const normalized = normalizeHomeLayout(layout);
    const widget = normalized.widgets.find((entry) => entry.id === id);
    if (!widget || !COLUMNS.includes(column)) return normalized;
    const others = normalized.widgets.filter((entry) => entry.id !== id);
    const target = others.filter((entry) => entry.column === column);
    const at = Math.max(0, Math.min(Number.isInteger(index) ? index : target.length, target.length));
    const placed = [...target.slice(0, at), { ...widget, column }, ...target.slice(at)];
    return normalizeHomeLayout({
        widgets: [...others.filter((entry) => entry.column !== column), ...placed]
    });
}

export function setWidgetHidden(layout, id, hidden) {
    const normalized = normalizeHomeLayout(layout);
    return {
        widgets: normalized.widgets.map((widget) => (widget.id === id ? { ...widget, hidden: hidden === true } : widget))
    };
}

/** What Home renders: the visible widgets of each column, as registry entries, in order. */
export function visibleColumns(layout) {
    const visible = (column) => widgetsInColumn(layout, column)
        .filter((widget) => !widget.hidden)
        .map((widget) => HOME_WIDGETS.find((entry) => entry.id === widget.id));
    return { main: visible('main'), side: visible('side') };
}
