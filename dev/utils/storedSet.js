/**
 * A set of ids kept in this browser's localStorage (e.g. which Home sections are folded on a phone).
 * Unreadable or missing storage falls back to `fallback`; a failed save is ignored, so the choice then
 * lasts only until the page reloads (private mode, quota).
 */

export function loadStoredSet(key, fallback = []) {
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        return new Set(Array.isArray(saved) ? saved : fallback);
    } catch {
        return new Set(fallback);
    }
}

export function saveStoredSet(key, ids) {
    try {
        localStorage.setItem(key, JSON.stringify([...ids]));
    } catch {
        // Storage unavailable: keep the choice in memory only.
    }
}

/** A copy of `ids` with `id` added, or removed if it was there. */
export function toggledSet(ids, id) {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
}
