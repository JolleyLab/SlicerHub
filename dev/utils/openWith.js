/**
 * Opening a case file: which toolkit (each opens in its own viewer), or a plain viewer, and what
 * the Open ▾ menu offers. Pure functions over GET /api/cases/:id/workflows (docs/workflows-design.md
 * › Workflows in cases). A choice from the menu opens the file once; nothing is remembered.
 */

export const VIEWER = Object.freeze({ SLICERWEB: 'slicerweb', FULL: 'full' });
/** Each viewer's name, as an i18n key. */
export const VIEWER_NAME_KEY = Object.freeze({ [VIEWER.SLICERWEB]: 'viewers.slicerWeb', [VIEWER.FULL]: 'viewers.fullSlicer' });
/** SlicerHeart's simplified viewer: Full Slicer starts it through its own simplified mode. */
export const SIMPLIFIED_VIEWER_MODULE = 'SimplifiedViewer';
/** The menu's sections, the first part of each entry's key. */
export const WORKFLOW_SECTION = Object.freeze({ VIEWER: 'viewer', CASE: 'case', OWN: 'mine' });
/** A menu entry's key: "case:<approval id>", "mine:<workflow id>" or "viewer:<viewer>". */
export const workflowKey = (section, id) => `${section}:${id}`;
/** A plain viewer's key: opening with no toolkit. */
export const viewerKey = (viewer) => workflowKey(WORKFLOW_SECTION.VIEWER, viewer);
/** Workflows shown in the menu before "More workflows…". */
export const MENU_LIMIT = 5;

/** The account viewer setting as a viewer; 'simplified' (now a workflow) means Full Slicer. */
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
    viewer: w.viewer === VIEWER.FULL ? VIEWER.FULL : VIEWER.SLICERWEB,
    iconUrl: w.iconUrl || null,
});

/**
 * Whether a viewer can run a workflow: it has every extension, supports every startup key, and can
 * start in the workflow's module. `slicerWebExtensions` null (unknown) counts as all. Before the
 * case's data loads, only SlicerWeb can.
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
 * What can open this file (fileName null: the blank viewer): `viewers`, the plain viewers; then
 * the case's workflows and the person's own (unless the case turns them off) that fit the file
 * and can run in their own viewer. An own workflow the case has approved is listed only as the
 * case's, since its approved copy is what the case uses. The blank viewer is SlicerWeb only, and
 * Full Slicer is offered once the case's data has loaded (canRun's rule).
 */
export function usableWorkflows(data, { fileName = null, slicerWebExtensions = null } = {}) {
    const blank = fileName == null;
    const types = blank ? [] : fileTypesOf(fileName);
    const fits = (w) => blank || !w.fileTypes.length || w.fileTypes.some((t) => types.includes(t));
    const usable = (w) => fits(w) && (!blank || w.viewer === VIEWER.SLICERWEB)
        && canRun(w, w.viewer, { viewers: data?.viewers, slicerWebExtensions });
    const caseWorkflows = (data?.approved || []).map((a) => toEntry(a, WORKFLOW_SECTION.CASE));
    const inCase = new Set(caseWorkflows.map((e) => e.workflowId));
    const mine = data?.allowPersonal === false ? [] : (data?.mine || []).map((w) => toEntry(w, WORKFLOW_SECTION.OWN));
    return {
        viewers: blank || !data?.viewers?.[VIEWER.FULL] ? [VIEWER.SLICERWEB] : Object.values(VIEWER),
        caseWorkflows: caseWorkflows.filter(usable),
        mine: mine.filter((e) => !inCase.has(e.workflowId) && usable(e)),
    };
}

/** What a menu key opens, if `usable` offers it: { key, viewer, workflow } (workflow null for a plain viewer). */
export function choiceFor(usable, key) {
    const viewer = usable.viewers.find((v) => viewerKey(v) === key);
    if (viewer) return { key, viewer, workflow: null };
    const workflow = [...usable.caseWorkflows, ...usable.mine].find((e) => e.key === key);
    return workflow ? { key, viewer: workflow.viewer, workflow } : null;
}

/** The workflows that add an extension a launch didn't have: what may read a file it couldn't. */
export const workflowsAddingExtensions = (workflows, extensions = []) =>
    workflows.filter((w) => w.extensions.some((ext) => !extensions.includes(ext)));

/**
 * What clicking a file opens: { key, viewer, workflow (entry or null), from: 'default' | 'none',
 * usable }. The case default, if usable here; else the person's account viewer with no workflow
 * (the blank viewer: SlicerWeb).
 */
export function resolveOpen(data, { fileName = null, accountViewer = 'web', slicerWebExtensions = null } = {}) {
    const usable = usableWorkflows(data, { fileName, slicerWebExtensions });
    const byDefault = data?.defaultWorkflow && choiceFor(usable, workflowKey(WORKFLOW_SECTION.CASE, data.defaultWorkflow));
    if (byDefault) return { ...byDefault, from: 'default', usable };
    const viewer = fileName == null ? VIEWER.SLICERWEB : viewerFromAccount(accountViewer);
    return { key: viewerKey(viewer), viewer, workflow: null, from: 'none', usable };
}

/** The first MENU_LIMIT workflows, keeping the selected one: { caseWorkflows, mine, hidden }. */
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
