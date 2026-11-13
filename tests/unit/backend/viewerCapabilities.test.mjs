import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers/caseRouteMocks.mjs'; // workflows.js imports the Payload client

const { fullSlicerExtensions, viewerCapabilities } = await import('../../../backend/src/services/viewerCapabilities.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-caps-'));
const syncDir = path.join(root, 'slicer-addons');
const bundled = path.join(root, 'bundled.json');
const write = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));

beforeEach(() => {
    fs.rmSync(syncDir, { recursive: true, force: true });
    fs.mkdirSync(syncDir, { recursive: true });
    fs.rmSync(bundled, { force: true });
    process.env.SLICER_ADDONS_HOST_DIR = syncDir;
    process.env.SLICER_ADDONS_MANIFEST = bundled;
});
after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.SLICER_ADDONS_HOST_DIR;
    delete process.env.SLICER_ADDONS_MANIFEST;
});

describe('fullSlicerExtensions', () => {
    it('uses the bundled manifest before the first add-ons sync', () => {
        write(bundled, { extensions: ['Sandbox', 'SlicerHeart'], modules: [] });
        write(path.join(syncDir, 'slicer-addons.json'), { extensions: ['SlicerRT'] }); // no .last-sync yet
        assert.deepEqual(fullSlicerExtensions(), ['Sandbox', 'SlicerHeart']);
    });

    it('prefers the synced manifest, which is what seats mount', () => {
        write(bundled, { extensions: ['Sandbox', 'SlicerHeart'] });
        write(path.join(syncDir, 'slicer-addons.json'), { extensions: ['SlicerHeart', 'SlicerVMTK'] });
        write(path.join(syncDir, '.last-sync'), 'ok');
        assert.deepEqual(fullSlicerExtensions(), ['SlicerHeart', 'SlicerVMTK']);
    });

    it('falls back when the synced copy is unreadable, and is empty with no manifest at all', () => {
        write(bundled, { extensions: ['SlicerHeart'] });
        write(path.join(syncDir, '.last-sync'), 'ok');
        write(path.join(syncDir, 'slicer-addons.json'), '{ not json');
        assert.deepEqual(fullSlicerExtensions(), ['SlicerHeart']);
        fs.rmSync(bundled);
        assert.deepEqual(fullSlicerExtensions(), []);
    });
});

describe('viewerCapabilities', () => {
    it("both take a start module; SlicerWeb can't start in SimplifiedViewer; Full Slicer has its manifest", () => {
        write(bundled, { extensions: ['SlicerHeart'] });
        assert.deepEqual(viewerCapabilities(), {
            slicerweb: { startupKeys: ['module'], unsupportedModules: ['SimplifiedViewer'] },
            full: { extensions: ['SlicerHeart'], startupKeys: ['module'], unsupportedModules: [] },
        });
    });
});
