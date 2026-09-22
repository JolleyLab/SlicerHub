/**
 * Lightweight UI string lookup for future locale / brand packs.
 *
 * Usage: t('auth.login.title') or t('common.count', { n: 3 })
 * Placeholders: {name} style only (no ICU plural engine yet).
 *
 * Swap language later with setLocaleMessages(partialOrFullCatalog).
 */

import en from './locales/en.js';

let catalog = en;

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

/**
 * Resolve a catalog key to localized text.
 * Falls back to the key itself if missing (makes typos obvious in UI).
 */
export function t(key, vars) {
    const raw = lookup(key);
    if (raw == null) return key;
    return format(raw, vars);
}

/** Deep-merge overrides onto the active catalog (brand / locale packs). */
export function setLocaleMessages(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    catalog = deepMerge(catalog, overrides);
}

/** Reset to built-in English (tests / brand clear). */
export function resetLocaleMessages() {
    catalog = en;
}

export function getLocaleCatalog() {
    return catalog;
}

function deepMerge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
        if (v && typeof v === 'object' && !Array.isArray(v)
            && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

export default t;
