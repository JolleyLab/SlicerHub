import { t } from '../i18n/index.js';

/** Sort choices for <list-filter-tools> on card lists (cases, attachments, workflows). */
export const LIST_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'newest', label: t('cases.sortNewest'), ariaLabel: t('cases.sortNewestAria') }),
    Object.freeze({ value: 'oldest', label: t('cases.sortOldest'), ariaLabel: t('cases.sortOldestAria') }),
    Object.freeze({ value: 'title', label: t('cases.sortTitle'), ariaLabel: t('cases.sortTitleAria') }),
]);

/** Rows where any of `textsOf(row)` contains `query` (case-insensitive); all rows for an empty query. */
export function filterByText(rows, query, textsOf) {
    const list = Array.isArray(rows) ? rows : [];
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [...list];
    return list.filter((row) => textsOf(row).some((text) => String(text || '').toLowerCase().includes(needle)));
}

/**
 * A sorted copy: 'title' (A–Z, then id), else by time ('oldest' first, otherwise newest first),
 * rows without a time last, ties by title.
 */
export function sortRows(rows, order, { titleOf, timeOf }) {
    const list = Array.isArray(rows) ? [...rows] : [];
    const title = (row) => String(titleOf(row) || '').toLowerCase();
    const byTitle = (a, b) => title(a).localeCompare(title(b), undefined, { sensitivity: 'base' });
    const time = (row) => {
        const value = Date.parse(timeOf(row) || '');
        return Number.isFinite(value) ? value : null;
    };

    if (order === 'title') {
        return list.sort((a, b) => byTitle(a, b) || String(a.id || '').localeCompare(String(b.id || '')));
    }
    const newestFirst = order !== 'oldest';
    return list.sort((a, b) => {
        const ta = time(a);
        const tb = time(b);
        if (ta == null && tb == null) return byTitle(a, b);
        if (ta == null) return 1;
        if (tb == null) return -1;
        return (newestFirst ? tb - ta : ta - tb) || byTitle(a, b);
    });
}
