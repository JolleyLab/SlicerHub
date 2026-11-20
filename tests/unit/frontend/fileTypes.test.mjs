import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFileExtension, formatFileExtension } from '../../../dev/utils/fileTypes.js';

test('normalizeFileExtension accepts *.ext, .ext and ext, any case, and multi-part extensions', () => {
    assert.equal(normalizeFileExtension('*.MRB'), 'mrb');
    assert.equal(normalizeFileExtension(' .nrrd '), 'nrrd');
    assert.equal(normalizeFileExtension('nhdr'), 'nhdr');
    assert.equal(normalizeFileExtension('.nii.gz'), 'nii.gz');
    assert.equal(normalizeFileExtension('seg.nrrd'), 'seg.nrrd');
});

test('normalizeFileExtension refuses anything that isn\'t an extension', () => {
    for (const bad of ['', '.', '*', '../etc', 'm r b', 'mrb/', 'a.b.c.d.e', '*.']) {
        assert.equal(normalizeFileExtension(bad), null, bad);
    }
});

test('formatFileExtension shows a leading dot', () => {
    assert.equal(formatFileExtension('nii.gz'), '.nii.gz');
});
