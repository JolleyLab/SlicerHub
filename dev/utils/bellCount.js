/**
 * To-do counts for the notification bell (registrations, case invites, workflow requests). The
 * server sends { count, latestAt } (backend utils/bellCount.js). Like most sites' bells, the dot
 * is for what's new since the bell was last opened: to-dos stay listed until handled, but only
 * ones that arrived after that light it.
 */

export const NO_TODOS = Object.freeze({ count: 0, latestAt: null });

/** A count response as { count, latestAt }; anything unusable counts as none. */
export const toBellCount = (data) => ({ count: Number(data?.count) || 0, latestAt: data?.latestAt || null });

/**
 * Whether any to-do arrived after the bell was last opened (if it never was, any to-do).
 * @param {Array<{ count: number, latestAt: string|null }>} counts
 * @param {string|null} bellOpenedAt
 */
export function hasNewTodo(counts, bellOpenedAt) {
    const opened = bellOpenedAt ? Date.parse(bellOpenedAt) : NaN;
    return counts.some((c) => c.count > 0
        && (!Number.isFinite(opened) || (c.latestAt != null && Date.parse(c.latestAt) > opened)));
}
