/**
 * What each viewer can run (docs/workflows-design.md › Viewers and workflows). A viewer can run a
 * workflow when every extension it needs is available there and its startup configuration only
 * uses keys the viewer supports. The SPA applies that rule; this says what Full Slicer has.
 *
 * SlicerWeb's extensions aren't listed here: the SPA reads them from the build's own
 * extensions/index.json, per channel.
 */

import fs from 'fs';
import path from 'path';
import { slicerAddonsHostDir, slicerAddonsSyncReady } from '../slicerGui/paths.js';
import { STARTUP_CONFIG_KEYS } from './workflows.js';

/** The manifest Full Slicer seats are built from, mounted read-only (docker-compose.yml). */
const bundledManifest = () => process.env.SLICER_ADDONS_MANIFEST || '/etc/slicer-addons.json';

function readExtensions(file) {
    try {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(manifest.extensions) ? manifest.extensions.map(String) : null;
    } catch {
        return null;
    }
}

/**
 * Extensions every Full Slicer seat loads: the manifest from the last add-ons sync (what seats
 * mount), else the one the seat image was built from, else none. Read per call: it's a few
 * bytes, and a sync can change it at any time.
 */
export function fullSlicerExtensions() {
    const dir = slicerAddonsHostDir();
    const synced = slicerAddonsSyncReady(dir) ? readExtensions(path.join(dir, 'slicer-addons.json')) : null;
    return synced ?? readExtensions(bundledManifest()) ?? [];
}

/**
 * For GET /api/cases/:id/workflows: what each viewer offers. Full Slicer gets `module` once its
 * open request carries the startup configuration (it only knows useSimplifiedViewer today).
 */
export const viewerCapabilities = () => ({
    slicerweb: { startupKeys: Object.keys(STARTUP_CONFIG_KEYS) },
    full: { extensions: fullSlicerExtensions(), startupKeys: [] },
});
