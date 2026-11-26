import { t } from '../i18n/index.js';

const FORMAT_KEYWORDS = [
    'load failed', 'unsupported', 'not supported', 'no reader', 'unrecognized',
    'unable to load', 'unable to read', 'cannot read', "can't read",
    'invalid format', 'failed to load node', 'createnodebyclass',
];

const TRANSIENT_KEYWORDS = ['timeout', 'timed out', 'connection', 'network', 'crash', 'killed', 'out of memory'];

/**
 * What Slicer reports when nothing recognised a file's format, so it may need an extension
 * (docs/workflows-design.md › When a file needs an extension): ITK's general reader giving up,
 * or SlicerWeb finding no reader at all. Matched on text: if a Slicer version words these
 * differently, the file just gets the usual error.
 */
const UNRECOGNISED_FORMAT = [/could not create io object for reading file/i, /no reader is available for/i];

export const isUnrecognisedFormat = (text) => UNRECOGNISED_FORMAT.some((re) => re.test(String(text ?? '')));

/** A load that failed because the file's format wasn't recognised (see isUnrecognisedFormat). */
export class UnrecognisedFormatError extends Error {}

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
