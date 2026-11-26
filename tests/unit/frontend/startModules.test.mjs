import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_MODULES, startModuleGroups, isStartModuleMissing } from '../../../dev/utils/startModules.js';

// SlicerWeb's extension lists, trimmed. On stable, SlicerHeart doesn't ship SimplifiedViewer.
const CATALOGS = {
    stable: [
        { name: 'SlicerHeart', modules: ['ValveView', 'CardiacDeviceSimulator'] },
        { name: 'SlicerRT', modules: ['Isodose'] },
        { name: 'MarkupsToModel', modules: [] },
    ],
    latest: [
        { name: 'SlicerHeart', modules: ['ValveView', 'CardiacDeviceSimulator', 'SimplifiedViewer'] },
        { name: 'SlicerRT', modules: ['Isodose'] },
    ],
};
const names = (group) => group.modules.map((m) => m.name);

describe('startModuleGroups', () => {
    it('offers the core modules with no extensions', () => {
        const groups = startModuleGroups([], CATALOGS);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].extension, null);
        assert.deepEqual(names(groups[0]), [...CORE_MODULES]);
    });

    it('adds the ticked extensions\' modules, sorted, from both channels', () => {
        const groups = startModuleGroups(['SlicerRT', 'SlicerHeart'], CATALOGS);
        assert.deepEqual(groups.map((g) => g.extension), [null, 'SlicerHeart', 'SlicerRT']);
        assert.deepEqual(names(groups[1]), ['CardiacDeviceSimulator', 'SimplifiedViewer', 'ValveView']);
    });

    it('flags modules only the latest channel ships, and ones SlicerWeb can\'t start in', () => {
        const heart = startModuleGroups(['SlicerHeart'], CATALOGS)[1].modules;
        const simplified = heart.find((m) => m.name === 'SimplifiedViewer');
        assert.deepEqual(simplified, { name: 'SimplifiedViewer', latestOnly: true, fullSlicerOnly: true });
        assert.deepEqual(heart.find((m) => m.name === 'ValveView'), { name: 'ValveView', latestOnly: false, fullSlicerOnly: false });
    });

    it('leaves out extensions with no modules, or not in either list', () => {
        assert.equal(startModuleGroups(['MarkupsToModel', 'Unknown'], CATALOGS).length, 1);
    });

    it('still offers the core modules when the lists could not be loaded', () => {
        assert.deepEqual(startModuleGroups(['SlicerHeart'], { stable: null, latest: null }).map((g) => g.extension), [null]);
    });
});

describe('isStartModuleMissing', () => {
    const groups = startModuleGroups(['SlicerRT'], CATALOGS);
    it('is false when unset or offered', () => {
        assert.equal(isStartModuleMissing('', groups), false);
        assert.equal(isStartModuleMissing('Isodose', groups), false);
        assert.equal(isStartModuleMissing('Volumes', groups), false);
    });
    it('is true when its extension is not ticked', () => {
        assert.equal(isStartModuleMissing('ValveView', groups), true);
    });
});
