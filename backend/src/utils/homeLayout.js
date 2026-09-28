/**
 * Home page layout preference: { widgets: [{ id, column: 'main' | 'side', hidden }] }. Unknown widget
 * ids are dropped and missing ones are added to the main column, so an old saved layout keeps working
 * when widgets are added. An older layout with a `columns` field is read without it.
 * Keep KNOWN_WIDGET_IDS equal to HOME_WIDGETS in dev/utils/homeLayout.js (a test checks it).
 */

export const KNOWN_WIDGET_IDS = Object.freeze(['todo', 'activity', 'recent-cases']);

export function normalizeHomeLayout(input) {
    const saved = Array.isArray(input?.widgets) ? input.widgets.slice(0, 50) : [];
    const seen = new Set();
    const widgets = [];
    for (const entry of saved) {
        const id = entry && typeof entry === 'object' ? entry.id : null;
        if (!KNOWN_WIDGET_IDS.includes(id) || seen.has(id)) continue;
        seen.add(id);
        widgets.push({ id, column: entry.column === 'side' ? 'side' : 'main', hidden: entry.hidden === true });
    }
    for (const id of KNOWN_WIDGET_IDS) {
        if (!seen.has(id)) widgets.push({ id, column: 'main', hidden: false });
    }
    return { widgets: [...widgets.filter((w) => w.column === 'main'), ...widgets.filter((w) => w.column === 'side')] };
}
