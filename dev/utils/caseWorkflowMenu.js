/**
 * The Open ▾ menu on a case (docs/workflows-design.md › Workflows in cases): what it lists for a
 * file or the blank viewer, which workflow the main button opens, and the per-file choice.
 *
 * An entry: { key, name?, nameKey?, description, hintKey?, target, extensions?, simplified?, builtin? }
 *   key: 'approved:<case-workflows id>' | 'mine:<workflow id>' | a built-in id
 *   target: 'slicerweb' | 'full_slicer'
 */

export const BUILTIN = Object.freeze({
    SLICERWEB: 'builtin:slicerweb',
    FULL: 'builtin:full',
    SIMPLIFIED: 'builtin:simplified',
});

/** The plain viewers. Their names and hints are i18n keys; SlicerWeb opens with its default extensions. */
export const BUILTIN_WORKFLOWS = Object.freeze([
    { key: BUILTIN.SLICERWEB, builtin: true, target: 'slicerweb', nameKey: 'viewers.inBrowser', hintKey: 'viewers.slicerWeb' },
    { key: BUILTIN.FULL, builtin: true, target: 'full_slicer', nameKey: 'viewers.fullSlicer', hintKey: 'viewers.fullSlicerHint' },
    { key: BUILTIN.SIMPLIFIED, builtin: true, target: 'full_slicer', simplified: true, nameKey: 'viewers.simplified', hintKey: 'viewers.simplifiedMenuHint' },
]);

/** The built-in workflow for the account's default viewer ('web' | 'full' | 'simplified'). */
export const builtinForViewer = (viewer) => (
    viewer === 'full' ? BUILTIN.FULL : viewer === 'simplified' ? BUILTIN.SIMPLIFIED : BUILTIN.SLICERWEB
);

/** The file types a name could match, longest first: "a.seg.nrrd" → ["seg.nrrd", "nrrd"]. */
export function fileTypesOf(fileName) {
    const parts = String(fileName || '').toLowerCase().split('.').slice(1);
    return parts.map((_, i) => parts.slice(i).join('.')).filter((ext) => ext.split('.').length <= 4);
}

const fitsFile = (fileTypes, candidates) => !fileTypes?.length || candidates.some((c) => fileTypes.includes(c));

const fromApproval = (a) => ({
    key: `approved:${a.id}`, name: a.name, description: a.description || '', target: 'slicerweb',
    extensions: a.extensions || [], fileTypes: a.fileTypes || [],
});
const fromMine = (w) => ({
    key: `mine:${w.id}`, name: w.name, description: w.description || '', target: 'slicerweb',
    extensions: w.extensions || [], fileTypes: w.fileTypes || [],
});

/** A stored case default (an approval id or a built-in id) as a menu key. */
const defaultKey = (raw) => (raw ? (String(raw).startsWith('builtin:') ? String(raw) : `approved:${raw}`) : null);

/**
 * What the menu lists for `fileName` (null: the blank viewer), from GET /api/cases/:id/workflows.
 * Workflows for other file types are left out; the blank viewer only offers SlicerWeb.
 * Returns { recommended, yours, builtins, all } — `all` is every usable entry, unfiltered by type.
 */
export function workflowMenu(data, { fileName = null } = {}) {
    const blank = fileName == null;
    const types = blank ? [] : fileTypesOf(fileName);
    const fits = (e) => blank || fitsFile(e.fileTypes, types);
    const approved = (data?.approved || []).map(fromApproval);
    const mine = data?.allowPersonal === false ? [] : (data?.mine || []).map(fromMine);
    const builtins = BUILTIN_WORKFLOWS.filter((e) => !blank || e.target === 'slicerweb');
    return {
        recommended: approved.filter(fits),
        yours: mine.filter(fits),
        builtins,
        all: [...approved, ...mine, ...builtins],
    };
}

/** The case's default for `fileName` (null: blank viewer), as a menu key, or null. */
export function caseDefaultKey(defaults, fileName = null) {
    if (!defaults) return null;
    if (fileName == null) return defaultKey(defaults.blank);
    const byType = fileTypesOf(fileName).map((ext) => defaults[ext]).find(Boolean);
    return defaultKey(byType ?? defaults['*']);
}

/**
 * Which entry the main button opens: the person's choice for this file, then the case default,
 * then the account's default viewer, then SlicerWeb. Anything no longer usable is skipped.
 */
export function resolveWorkflow(menu, { saved = null, caseDefault = null, accountDefault = BUILTIN.SLICERWEB } = {}) {
    const find = (key) => (key ? menu.all.find((e) => e.key === key) : null);
    return find(saved) || find(caseDefault) || find(accountDefault) || menu.builtins[0];
}

// ── Choices per file ───────────────────────────────────────────────────────

// Under slicerweb.* so sign-out clears it with SlicerWeb's own state (utils/slicerWebStorage.js).
const CHOICE_KEY = 'slicerweb.hub.workflowChoices';
const MAX_CHOICES = 500;
const choiceId = (caseId, attachmentId) => `${caseId}:${attachmentId ?? 'blank'}`;

function readChoices(storage) {
    try { return JSON.parse(storage?.getItem(CHOICE_KEY) || '{}') || {}; } catch { return {}; }
}

/** The key last picked for this file (attachmentId null: the blank viewer), or null. */
export const readWorkflowChoice = (caseId, attachmentId, storage = globalThis.localStorage) =>
    readChoices(storage)[choiceId(caseId, attachmentId)] ?? null;

/** Remember a pick; keeps the most recent MAX_CHOICES. */
export function saveWorkflowChoice(caseId, attachmentId, key, storage = globalThis.localStorage) {
    const choices = readChoices(storage);
    const id = choiceId(caseId, attachmentId);
    delete choices[id]; // re-adding moves it to the end, the newest
    choices[id] = key;
    const entries = Object.entries(choices).slice(-MAX_CHOICES);
    try { storage?.setItem(CHOICE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* full or blocked */ }
}
