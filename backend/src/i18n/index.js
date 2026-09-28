/**
 * User-facing API message catalog (English default).
 * Console / FATAL / internal ops strings stay inline at call sites.
 *
 * Prefer: throw new ValidationError(msg('auth.invalid_credentials'), 'INVALID_CREDENTIALS')
 * so the SPA can later map `error.code` / `error.key` without parsing English.
 */

import en from './locales/en.js';

const catalog = en;

function lookup(key) {
    if (!key || typeof key !== 'string') return undefined;
    const parts = key.split('.');
    let cur = catalog;
    for (const part of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[part];
    }
    return typeof cur === 'string' ? cur : undefined;
}

function format(template, vars = {}) {
    if (!vars || typeof vars !== 'object') return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => (
        vars[name] != null && vars[name] !== undefined ? String(vars[name]) : `{${name}}`
    ));
}

/** Resolve a message key; falls back to key if missing. */
export function msg(key, vars) {
    const raw = lookup(key);
    if (raw == null) return key;
    return format(raw, vars);
}

export default msg;
