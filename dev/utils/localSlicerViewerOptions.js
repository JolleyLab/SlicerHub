/**
 * Shared helpers for Local + Full Slicer viewer preferences.
 * Keep option names/defaults here so project pages and user settings UIs
 * can reuse the same contract.
 *
 * Account persistence lives in utils/userPreferences.js (server-backed).
 */

export const LOCAL_SLICER_VIEWER_OPTION_KEYS = Object.freeze({
    useFullSlicer: 'useFullSlicer',
    useSimplifiedViewer: 'useSimplifiedViewer'
});

export const DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS = Object.freeze({
    useFullSlicer: false,
    useSimplifiedViewer: false
});

/**
 * Normalize API / form values into a consistent options object.
 * Simplified viewer is only meaningful when Full Slicer is enabled.
 */
export function normalizeLocalSlicerViewerOptions(input = {}) {
    const useFullSlicer = input?.useFullSlicer === true;
    const useSimplifiedViewer = useFullSlicer && input?.useSimplifiedViewer === true;
    return {
        useFullSlicer,
        useSimplifiedViewer
    };
}

export function mergeLocalSlicerViewerOptionPatch(current = {}, patch = {}) {
    const base = normalizeLocalSlicerViewerOptions(current);
    const next = {
        ...base,
        ...patch
    };
    return normalizeLocalSlicerViewerOptions(next);
}
