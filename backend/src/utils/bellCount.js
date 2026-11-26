/**
 * A bell count of to-dos waiting (registrations, case invites, workflow requests): how many, and
 * when the newest arrived. The bell's dot lights only for to-dos newer than the last time the
 * user opened it (routes/notifications.js); the to-dos stay listed in the bell until handled.
 *
 * @param {Array<string|Date|null>} arrivedAt one entry per to-do
 * @returns {{ count: number, latestAt: string|null }}
 */
export function bellCount(arrivedAt) {
    const times = arrivedAt.map((d) => (d ? new Date(d).getTime() : NaN)).filter(Number.isFinite);
    return { count: arrivedAt.length, latestAt: times.length ? new Date(Math.max(...times)).toISOString() : null };
}
