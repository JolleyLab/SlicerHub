/**
 * Helpers for the SlicerWeb WASM bridge used by the case viewer.
 */

/**
 * Parse the Python repr of a list of node IDs returned by evalPython.
 *
 * Python repr for a list of strings looks like:
 *   ['vtkMRMLScalarVolumeNode1', 'vtkMRMLModelNode2']
 *
 * JSON.parse can handle it after swapping single quotes for double quotes,
 * but falls back gracefully for anything else:
 *   - empty repr '[]'  → []
 *   - non-empty but unparseable → ['loaded']  (signals something loaded)
 *
 * @param {string} repr  The raw string returned by evalPython in 'eval' mode.
 * @returns {string[]}
 */
export function parseNodeIdsRepr(repr) {
    try {
        return JSON.parse(repr.replace(/'/g, '"'));
    } catch {
        return repr === '[]' ? [] : ['loaded'];
    }
}
