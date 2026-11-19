/**
 * Opening a case file (docs/workflows-design.md › Workflows in cases): which viewer, which
 * workflow on top, and what the Open ▾ menu offers. A launch is a viewer plus, optionally, a
 * workflow the viewer can run. Pure functions over GET /api/cases/:id/workflows, plus the
 * per-file picks kept in the browser.
 */

export const VIEWER = Object.freeze({ SLICERWEB: 'slicerweb', FULL: 'full' });
/** SlicerHeart's simplified viewer: Full Slicer starts it through its own simplified mode. */
export const SIMPLIFIED_VIEWER_MODULE = 'SimplifiedViewer';
/** The menu's "No workflow" pick. */
export const NO_WORKFLOW = 'none';
/**
 * The menu's two sections: the case's approved workflows, and the person's own. The values are
 * part of the keys picks store in the browser, so they stay as they are.
 */
export const WORKFLOW_SECTION = Object.freeze({ CASE: 'case', OWN: 'mine' });
/** A menu entry's key, what picks store: "case:<approval id>" or "mine:<workflow id>". */
export const workflowKey = (section, id) => `${section}:${id}`;
/** Workflows shown in the menu before "More workflows…". */
export const MENU_LIMIT = 5;

/**
 * The account's viewer setting ('web' | 'full' | 'simplified') as a viewer. 'simplified' was always
 * Full Slicer with the simplified interface; that interface is now the "SlicerHeart – Simplified"
 * workflow, picked from the menu, so the setting just means Full Slicer.
 */
export const viewerFromAccount = (setting) => (setting === 'full' || setting === 'simplified' ? VIEWER.FULL : VIEWER.SLICERWEB);

/** The file types a name could match, longest first: "a.seg.nrrd" → ["seg.nrrd", "nrrd"]. */
export function fileTypesOf(fileName) {
    const parts = String(fileName || '').toLowerCase().split('.').slice(1);
    return parts.map((_, i) => parts.slice(i).join('.')).filter((ext) => ext.split('.').length <= 4);
}

/** A workflow as the menu lists it (`key`: workflowKey); `workflowId` is the source workflow either way. */
const toEntry = (w, section) => ({
    key: workflowKey(section, w.id),
    section,
    workflowId: String(section === WORKFLOW_SECTION.CASE ? w.workflowId : w.id),
    name: w.name,
    description: w.description || '',
    extensions: w.extensions || [],
    fileTypes: w.fileTypes || [],
    startupConfig: w.startupConfig || {},
});

/**
 * Whether a viewer can run a workflow: every extension it needs is available there, its
 * startup configuration only uses keys the viewer supports, and it doesn't start in a module
 * the viewer can't start in (`unsupportedModules`, e.g. SimplifiedViewer in SlicerWeb). SlicerWeb's extensions come from the
 * build's index.json (`slicerWebExtensions`; null while unknown counts as all); Full Slicer's
 * from the server (`viewers.full.extensions`). Before the case's data loads, only SlicerWeb.
 */
export function canRun(workflow, viewer, { viewers = null, slicerWebExtensions = null } = {}) {
    const caps = viewers?.[viewer];
    if (!caps) return viewer === VIEWER.SLICERWEB;
    const available = viewer === VIEWER.SLICERWEB ? slicerWebExtensions : caps.extensions || [];
    const startModule = workflow.startupConfig?.module;
    return (!available || (workflow.extensions || []).every((ext) => available.includes(ext)))
        && Object.keys(workflow.startupConfig || {}).every((key) => (caps.startupKeys || []).includes(key))
        && !(startModule && (caps.unsupportedModules || []).includes(startModule));
}

/**
 * What can open this file (fileName null: the blank viewer) in this viewer, right now: the
 * case's workflows, then the person's own (unless the case turns them off). Workflows for other
 * file types, or that the viewer can't run, are left out. One of your own that the case has
 * approved is listed only as the case's: its approved copy is what everyone in the case gets.
 */
export function usableWorkflows(data, { fileName = null, viewer = VIEWER.SLICERWEB, slicerWebExtensions = null } = {}) {
    const types = fileName == null ? [] : fileTypesOf(fileName);
    const fits = (w) => fileName == null || !w.fileTypes.length || w.fileTypes.some((t) => types.includes(t));
    const usable = (w) => fits(w) && canRun(w, viewer, { viewers: data?.viewers, slicerWebExtensions });
    const caseWorkflows = (data?.approved || []).map((a) => toEntry(a, WORKFLOW_SECTION.CASE));
    const inCase = new Set(caseWorkflows.map((e) => e.workflowId));
    const mine = data?.allowPersonal === false ? [] : (data?.mine || []).map((w) => toEntry(w, WORKFLOW_SECTION.OWN));
    return {
        caseWorkflows: caseWorkflows.filter(usable),
        mine: mine.filter((e) => !inCase.has(e.workflowId) && usable(e)),
    };
}

/** The workflows that add an extension a launch didn't have: what may read a file it couldn't. */
export const workflowsAddingExtensions = (workflows, extensions = []) =>
    workflows.filter((w) => w.extensions.some((ext) => !extensions.includes(ext)));

/**
 * What opening a file does. Viewer: the person's pick for this file, else their account setting
 * (the blank viewer is always SlicerWeb). Workflow: their pick for this file (a workflow, or
 * NO_WORKFLOW), else the case's default, else none; each only if usable here.
 * Returns { viewer, workflow (an entry or null), from: 'pick' | 'default' | 'none' }.
 */
export function resolveOpen(data, { fileName = null, pick = null, accountViewer = 'web', slicerWebExtensions = null } = {}) {
    const blank = fileName == null;
    const pickedViewer = Object.values(VIEWER).includes(pick?.viewer) ? pick.viewer : null;
    const viewer = blank ? VIEWER.SLICERWEB : pickedViewer || viewerFromAccount(accountViewer);
    if (pick?.workflow === NO_WORKFLOW) return { viewer, workflow: null, from: 'pick' };
    const usable = usableWorkflows(data, { fileName, viewer, slicerWebExtensions });
    const picked = pick?.workflow && [...usable.caseWorkflows, ...usable.mine].find((e) => e.key === pick.workflow);
    if (picked) return { viewer, workflow: picked, from: 'pick' };
    const byDefault = data?.defaultWorkflow && usable.caseWorkflows.find((e) => e.key === workflowKey(WORKFLOW_SECTION.CASE, data.defaultWorkflow));
    if (byDefault) return { viewer, workflow: byDefault, from: 'default' };
    return { viewer, workflow: null, from: 'none' };
}

/**
 * The menu's short list: the first MENU_LIMIT workflows across both sections, keeping the
 * selected one visible. Returns { caseWorkflows, mine, hidden } (hidden: how many are left for
 * "More workflows…").
 */
export function shortList(usable, selectedKey = null, limit = MENU_LIMIT) {
    const all = [...usable.caseWorkflows, ...usable.mine];
    let shown = all.slice(0, limit);
    const selected = all.find((e) => e.key === selectedKey);
    if (selected && !shown.includes(selected)) shown = [...shown.slice(0, limit - 1), selected];
    return {
        caseWorkflows: usable.caseWorkflows.filter((e) => shown.includes(e)),
        mine: usable.mine.filter((e) => shown.includes(e)),
        hidden: all.length - shown.length,
    };
}

// ── Picks per file ─────────────────────────────────────────────────────────

// Under slicerweb.* so sign-out clears it with SlicerWeb's own state (utils/slicerWebStorage.js).
const PICKS_KEY = 'slicerweb.hub.openPicks';
const MAX_PICKS = 500;
const pickId = (caseId, attachmentId) => `${caseId}:${attachmentId ?? 'blank'}`;

// Storage failures don't stop a file opening, but picks then aren't remembered: say so once per
// page load (blocked storage would otherwise warn on every save).
const warned = new Set();
function warnOnce(what, err) {
    if (warned.has(what)) return;
    warned.add(what);
    console.warn(`[openWith] couldn't ${what} per-file picks; files will open with their defaults:`, err);
}

function readPicks(storage) {
    try {
        const picks = JSON.parse(storage?.getItem(PICKS_KEY) || '{}');
        if (picks && typeof picks === 'object' && !Array.isArray(picks)) return picks;
        warnOnce('read', new Error('stored picks are not an object'));
    } catch (err) {
        warnOnce('read', err);
    }
    return {};
}

/** This person's pick for a file (attachmentId null: the blank viewer): { viewer?, workflow? }, or null. */
export const readOpenPick = (caseId, attachmentId, storage = globalThis.localStorage) =>
    readPicks(storage)[pickId(caseId, attachmentId)] ?? null;

/** Remember part of a pick ({ viewer } or { workflow }); keeps the most recent MAX_PICKS files. */
export function saveOpenPick(caseId, attachmentId, change, storage = globalThis.localStorage) {
    const picks = readPicks(storage);
    const id = pickId(caseId, attachmentId);
    const merged = { ...picks[id], ...change };
    delete picks[id]; // re-adding moves it to the end, the newest
    picks[id] = merged;
    try {
        storage?.setItem(PICKS_KEY, JSON.stringify(Object.fromEntries(Object.entries(picks).slice(-MAX_PICKS))));
    } catch (err) {
        warnOnce('save', err); // storage full, or blocked (e.g. a private window)
    }
}
