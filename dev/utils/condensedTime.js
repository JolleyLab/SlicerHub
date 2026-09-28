/**
 * A short, relative time for cards: "now", "5 min. ago", "3 hr. ago", "yesterday", then a short date.
 * The full date and time belong in a tooltip (see fullTime).
 * @param {string} value ISO date and time
 * @param {{ now?: number, locale?: string }} [options]
 */
function toUtcMs(value) {
    const s = String(value || '').trim();
    // SQLite CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" with no timezone.
    // Date.parse treats that as local time, not UTC. Append Z to force UTC.
    const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
    return Date.parse(normalised);
}

export function condensedTime(value, { now = Date.now(), locale } = {}) {
    const ms = toUtcMs(value);
    if (!Number.isFinite(ms)) return '';
    const seconds = Math.round((ms - now) / 1000);
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs < 2 * 86400) return rtf.format(Math.round(seconds / 86400), 'day');
    return new Date(ms).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function fullTime(value, locale) {
    const ms = toUtcMs(value);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}
