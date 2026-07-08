/**
 * Shared Local Full Slicer viewer preference helpers (backend).
 * Keep names aligned with frontend/utils/localSlicerViewerOptions.js.
 */

export const DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS = Object.freeze({
    useFullSlicer: false,
    useSimplifiedViewer: false
});

export function normalizeLocalSlicerViewerOptions(input = {}) {
    const useFullSlicer = input?.useFullSlicer === true;
    const useSimplifiedViewer = useFullSlicer && input?.useSimplifiedViewer === true;
    return {
        useFullSlicer,
        useSimplifiedViewer
    };
}

export function readLocalSlicerViewerOptions(localPrefs = {}) {
    return normalizeLocalSlicerViewerOptions(localPrefs);
}

export function mergeLocalSlicerViewerOptions(existingLocalPrefs = {}, patch = {}) {
    return {
        ...existingLocalPrefs,
        ...normalizeLocalSlicerViewerOptions({
            ...existingLocalPrefs,
            ...patch
        })
    };
}
