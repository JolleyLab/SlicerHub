import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Seat folders live under <cwd>/data/slicer-gui (slicerGui/paths.js): work in a temporary one.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-file-'));
const startDir = process.cwd();
process.chdir(root);
const { stageCachedFileForSlicerGui } = await import('../../../backend/src/slicerGui/stageFile.js');

test.after(() => {
    process.chdir(startDir);
    fs.rmSync(root, { recursive: true, force: true });
});

const source = path.join(root, 'heart.mrb');
fs.writeFileSync(source, 'scene');
const readRequest = (seat = 1) => JSON.parse(fs.readFileSync(
    path.join(root, 'data', 'slicer-gui', 'users', 'u1', `seat${seat}`, '.open-request.json'), 'utf8',
));
const stage = (options) => stageCachedFileForSlicerGui({ sourcePath: source, stagedKey: 'pl-1', fileName: 'heart.mrb', launcherUserId: 'u1', ...options });

test("the open request carries a workflow's start module for the seat to select", async () => {
    await stage({ startModule: 'SegmentEditor' });
    const request = readRequest();
    assert.equal(request.startModule, 'SegmentEditor');
    assert.equal(request.useSimplifiedViewer, false);
});

test('with no start module, the request has none; Simplified still uses its own flag', async () => {
    await stage({ useSimplifiedViewer: true });
    const request = readRequest();
    assert.equal('startModule' in request, false);
    assert.equal(request.useSimplifiedViewer, true);
});
