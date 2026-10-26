import { t } from '../i18n/index.js';

const FORMAT_KEYWORDS = [
    'load failed', 'unsupported', 'not supported', 'no reader', 'unrecognized',
    'unable to load', 'unable to read', 'cannot read', "can't read",
    'invalid format', 'failed to load node', 'createnodebyclass',
];

const TRANSIENT_KEYWORDS = ['timeout', 'timed out', 'connection', 'network', 'crash', 'killed', 'out of memory'];

/**
 * Classify a raw Slicer error string into a user-facing { title, message } pair.
 * Format errors get a "not supported" message with no retry language.
 * Transient errors get a "try again" message.
 * Unknown errors get a generic fallback.
 */
export function classifySlicerLoadError(rawError) {
    const s = String(rawError || '').toLowerCase();
    if (FORMAT_KEYWORDS.some((kw) => s.includes(kw))) {
        return { title: t('errors.slicerLoadFailedTitle'), message: t('errors.slicerLoadFailedFormat') };
    }
    if (TRANSIENT_KEYWORDS.some((kw) => s.includes(kw))) {
        return { title: t('errors.slicerLoadFailedTransientTitle'), message: t('errors.slicerLoadFailedTransient') };
    }
    return { title: t('errors.slicerLoadFailedTitle'), message: t('errors.slicerLoadFailed') };
}
