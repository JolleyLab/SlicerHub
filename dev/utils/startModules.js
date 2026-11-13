import { SIMPLIFIED_VIEWER_MODULE } from './openWith.js';

/**
 * Slicer's own modules a workflow can start in, whatever its extensions (docs/workflows-design.md
 * › Startup configuration). Kept short: the usual places to begin.
 */
export const CORE_MODULES = Object.freeze([
    'Data', 'Volumes', 'VolumeRendering', 'Models', 'Markups', 'Segmentations', 'SegmentEditor', 'Transforms',
]);

/** Modules SlicerWeb can't start in; they still work in Full Slicer. */
const FULL_SLICER_ONLY = new Set([SIMPLIFIED_VIEWER_MODULE]);

/**
 * The "Start in" choices for a workflow's extensions, core modules first:
 * [{ extension (null for core), modules: [{ name, latestOnly, fullSlicerOnly }] }].
 * `catalogs` are SlicerWeb's extension lists ({ stable, latest } from loadExtensionCatalog); a
 * module only the latest channel ships is `latestOnly`.
 */
export function startModuleGroups(extensions, { stable = [], latest = [] } = {}) {
    const option = (name, inStable = true) => ({ name, latestOnly: !inStable, fullSlicerOnly: FULL_SLICER_ONLY.has(name) });
    const modulesOf = (catalog, extension) => new Set((catalog || []).find((e) => e.name === extension)?.modules || []);
    const groups = [{ extension: null, modules: CORE_MODULES.map((name) => option(name)) }];
    for (const extension of [...extensions].sort((a, b) => a.localeCompare(b))) {
        const inStable = modulesOf(stable, extension);
        const names = [...new Set([...inStable, ...modulesOf(latest, extension)])].sort((a, b) => a.localeCompare(b));
        if (names.length) groups.push({ extension, modules: names.map((name) => option(name, inStable.has(name))) });
    }
    return groups;
}

/** True if a start module is set but none of the choices offer it (e.g. its extension was unticked). */
export const isStartModuleMissing = (module, groups) =>
    Boolean(module) && !groups.some((group) => group.modules.some((m) => m.name === module));
