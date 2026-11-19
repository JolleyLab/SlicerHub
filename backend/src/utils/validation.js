import { ValidationError } from './errors.js';

/** Whether `id` can be a Payload document id (serial integers on Postgres). */
export const isDocId = (id) => /^[1-9]\d{0,15}$/.test(String(id ?? ''));

// `field` below is the catalog key of the field's name (e.g. 'workflow.fields.name'), for messages.

/**
 * A list of identifier-like names (extension names, module names…): an array of strings,
 * each matching `pattern`, at most `max` after trimming, `normalize` and removing duplicates.
 */
export function sanitizeNameList(value, {
    field = 'validation.value', max = 50, pattern = /^[\w.-]{1,100}$/, normalize = (s) => s,
} = {}) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw ValidationError.fromKey('validation.not_a_list', { field });
    const names = [...new Set(value.map((v) => normalize(String(v ?? '').trim())).filter(Boolean))];
    const bad = names.find((n) => !pattern.test(n));
    if (bad) throw ValidationError.fromKey('validation.invalid_name', { field, name: bad.slice(0, 100) });
    if (names.length > max) throw ValidationError.fromKey('validation.too_many', { field, max });
    return names;
}

/**
 * File extensions, stored lowercase without "*." or "." ("*.MRB" → "mrb"); multi-part ones such
 * as "nii.gz" or "seg.nrrd" are kept whole.
 */
export const sanitizeFileExtensions = (value, { field = 'workflow.fields.file_types', max = 30 } = {}) => sanitizeNameList(value, {
    field,
    max,
    pattern: /^[a-z0-9]+(\.[a-z0-9]+){0,3}$/,
    normalize: (s) => s.toLowerCase().replace(/^\*?\./, ''),
});

/** Trimmed text; `required` rejects empty, longer than `max` is rejected. */
export function sanitizeText(value, { field = 'validation.value', max = 200, required = false } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw ValidationError.fromKey('validation.required', { field });
    if (text.length > max) throw ValidationError.fromKey('validation.too_long', { field, max });
    return text;
}

/** One of `allowed`, else a ValidationError. */
export function sanitizeChoice(value, allowed, { field = 'validation.value' } = {}) {
    if (!allowed.includes(value)) throw ValidationError.fromKey('validation.not_one_of', { field, allowed: allowed.join(', ') });
    return value;
}
