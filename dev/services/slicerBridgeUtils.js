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

/** A Slicer module name, as the backend allows in a workflow's startup configuration. */
const MODULE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

/**
 * Python that shows a module's panel in SlicerWeb, for a workflow's start module once its file
 * has loaded; null for anything that isn't a module name. SlicerWeb's own ?module= runs before
 * the file loads and skips its built-in panels (Segment Editor), so this sends the message its
 * selectModule() sends, without the "is it loaded" check. That message (slicerweb.host) is a
 * SlicerWeb internal: if it changes, the module just isn't selected. Remove once SlicerWeb
 * handles both (docs/workflows-design.md › Startup configuration).
 */
export function selectModulePython(name) {
    if (!MODULE_NAME.test(String(name ?? ''))) return null;
    return `from slicerweb import host\nhost.emit('select-module', {'name': '${name}'})`;
}
