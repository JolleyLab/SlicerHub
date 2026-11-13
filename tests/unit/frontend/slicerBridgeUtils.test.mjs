import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNodeIdsRepr } from '../../../dev/services/slicerBridgeUtils.js';

// ── parseNodeIdsRepr ───────────────────────────────────────────────────────────

test('parses a Python repr list of node IDs into a JS array', () => {
    const repr = "['vtkMRMLScalarVolumeNode1', 'vtkMRMLModelNode2']";
    assert.deepEqual(parseNodeIdsRepr(repr), ['vtkMRMLScalarVolumeNode1', 'vtkMRMLModelNode2']);
});

test('parses a single-element list', () => {
    assert.deepEqual(parseNodeIdsRepr("['vtkMRMLScalarVolumeNode1']"), ['vtkMRMLScalarVolumeNode1']);
});

test('empty repr returns empty array', () => {
    assert.deepEqual(parseNodeIdsRepr('[]'), []);
});

test('non-parseable non-empty repr signals something loaded', () => {
    // WASM bridge returned binary garbage — treat as a successful load
    assert.deepEqual(parseNodeIdsRepr('}lSğ'), ['loaded']);
});

test('non-parseable repr starting with } is not confused with empty', () => {
    const result = parseNodeIdsRepr('}garbage');
    assert.notDeepEqual(result, []);
    assert.equal(result.length, 1);
});

test('node IDs containing underscores and digits parse correctly', () => {
    const repr = "['vtkMRMLMarkupsFiducialNode_1', 'vtkMRMLSegmentationNode42']";
    assert.deepEqual(parseNodeIdsRepr(repr), [
        'vtkMRMLMarkupsFiducialNode_1',
        'vtkMRMLSegmentationNode42',
    ]);
});

// ── selectModulePython ─────────────────────────────────────────────────────────

test('selectModulePython: emits select-module for a module name', async () => {
    const { selectModulePython } = await import('../../../dev/services/slicerBridgeUtils.js');
    assert.equal(selectModulePython('SegmentEditor'),
        "from slicerweb import host\nhost.emit('select-module', {'name': 'SegmentEditor'})");
});

test('selectModulePython: null for no name or anything that is not a module name', async () => {
    const { selectModulePython } = await import('../../../dev/services/slicerBridgeUtils.js');
    for (const name of [undefined, null, '', '1Volumes', "x'}); import os #", 'Segment Editor']) {
        assert.equal(selectModulePython(name), null, String(name));
    }
});
