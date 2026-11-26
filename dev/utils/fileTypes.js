/**
 * Data file extensions as workflows store them: lowercase, no "*." or "." ("*.MRB" → "mrb"),
 * multi-part ones kept whole ("nii.gz", "seg.nrrd"). Mirrors the backend's sanitizeFileExtensions.
 */

const PATTERN = /^[a-z0-9]+(\.[a-z0-9]+){0,3}$/;

/** The stored form of what someone typed, or null if it isn't a file extension. */
export function normalizeFileExtension(text) {
    const ext = String(text || '').trim().toLowerCase().replace(/^\*?\./, '');
    return PATTERN.test(ext) ? ext : null;
}

/** How to show one: ".mrb". */
export const formatFileExtension = (ext) => `.${ext}`;
