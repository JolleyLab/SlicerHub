import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILTIN, builtinForViewer, fileTypesOf, workflowMenu, caseDefaultKey, resolveWorkflow,
    readWorkflowChoice, saveWorkflowChoice,
} from '../../../dev/utils/caseWorkflowMenu.js';

const DATA = {
    approved: [
        { id: 7, name: 'Cardiac', extensions: ['SlicerHeart'], fileTypes: ['mrb'] },
        { id: 8, name: 'Any file', extensions: [], fileTypes: [] },
        { id: 9, name: 'Segments', extensions: [], fileTypes: ['seg.nrrd'] },
    ],
    mine: [{ id: 11, name: 'My TAVR', extensions: ['SlicerRT'], fileTypes: ['nii.gz'] }],
    allowPersonal: true,
    defaults: {},
};
const keys = (list) => list.map((e) => e.key);

describe('fileTypesOf', () => {
    it('lists every suffix, longest first, lowercase', () => {
        assert.deepEqual(fileTypesOf('Heart.SEG.nrrd'), ['seg.nrrd', 'nrrd']);
        assert.deepEqual(fileTypesOf('scan.nii.gz'), ['nii.gz', 'gz']);
        assert.deepEqual(fileTypesOf('README'), []);
    });
});

describe('workflowMenu', () => {
    it('offers workflows for the file type, or for any type', () => {
        const menu = workflowMenu(DATA, { fileName: 'heart.mrb' });
        assert.deepEqual(keys(menu.recommended), ['approved:7', 'approved:8']);
        assert.deepEqual(keys(menu.yours), []);
        assert.deepEqual(keys(menu.builtins), [BUILTIN.SLICERWEB, BUILTIN.FULL, BUILTIN.SIMPLIFIED]);
        assert.deepEqual(keys(workflowMenu(DATA, { fileName: 'a.seg.nrrd' }).recommended), ['approved:8', 'approved:9']);
        assert.deepEqual(keys(workflowMenu(DATA, { fileName: 'brain.nii.gz' }).yours), ['mine:11']);
    });

    it('the blank viewer lists every workflow but only SlicerWeb', () => {
        const menu = workflowMenu(DATA);
        assert.equal(menu.recommended.length, 3);
        assert.deepEqual(keys(menu.builtins), [BUILTIN.SLICERWEB]);
    });

    it('personal workflows disappear when the case turns them off', () => {
        const menu = workflowMenu({ ...DATA, allowPersonal: false }, { fileName: 'brain.nii.gz' });
        assert.deepEqual(menu.yours, []);
        assert.equal(menu.all.some((e) => e.key === 'mine:11'), false);
    });

    it('works before the case data has loaded', () => {
        const menu = workflowMenu(null, { fileName: 'x.mrb' });
        assert.deepEqual(menu.recommended, []);
        assert.equal(resolveWorkflow(menu).key, BUILTIN.SLICERWEB);
    });
});

describe('caseDefaultKey', () => {
    const defaults = { mrb: '7', 'seg.nrrd': '9', '*': 'builtin:full', blank: 'builtin:slicerweb' };
    it('picks the most specific file type, then all other files', () => {
        assert.equal(caseDefaultKey(defaults, 'a.mrb'), 'approved:7');
        assert.equal(caseDefaultKey(defaults, 'a.seg.nrrd'), 'approved:9');
        assert.equal(caseDefaultKey(defaults, 'a.nrrd'), BUILTIN.FULL);
        assert.equal(caseDefaultKey({}, 'a.nrrd'), null);
    });
    it('the blank viewer has its own default', () => {
        assert.equal(caseDefaultKey(defaults, null), BUILTIN.SLICERWEB);
        assert.equal(caseDefaultKey({ '*': '7' }, null), null);
    });
});

describe('resolveWorkflow', () => {
    const menu = workflowMenu(DATA, { fileName: 'heart.mrb' });
    it('the person\'s choice, then the case default, then their default viewer', () => {
        assert.equal(resolveWorkflow(menu, { saved: 'approved:8', caseDefault: 'approved:7' }).key, 'approved:8');
        assert.equal(resolveWorkflow(menu, { caseDefault: 'approved:7', accountDefault: BUILTIN.FULL }).key, 'approved:7');
        assert.equal(resolveWorkflow(menu, { accountDefault: BUILTIN.SIMPLIFIED }).key, BUILTIN.SIMPLIFIED);
    });
    it('skips choices that are no longer usable', () => {
        assert.equal(resolveWorkflow(menu, { saved: 'approved:99', caseDefault: 'approved:7' }).key, 'approved:7');
        const blank = workflowMenu(DATA);
        assert.equal(resolveWorkflow(blank, { accountDefault: BUILTIN.FULL }).key, BUILTIN.SLICERWEB);
    });
    it('a case default for another file type still applies when the admin chose it', () => {
        assert.equal(resolveWorkflow(menu, { caseDefault: 'approved:9' }).key, 'approved:9');
    });
    it('maps the account viewer setting to a built-in', () => {
        assert.equal(builtinForViewer('web'), BUILTIN.SLICERWEB);
        assert.equal(builtinForViewer('full'), BUILTIN.FULL);
        assert.equal(builtinForViewer('simplified'), BUILTIN.SIMPLIFIED);
    });
});

describe('workflow choices', () => {
    const storage = () => {
        const map = new Map();
        return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map };
    };
    it('remembers a pick per case and file, and for the blank viewer', () => {
        const s = storage();
        saveWorkflowChoice('1', '20', 'approved:7', s);
        saveWorkflowChoice('1', null, 'mine:11', s);
        assert.equal(readWorkflowChoice('1', '20', s), 'approved:7');
        assert.equal(readWorkflowChoice('1', null, s), 'mine:11');
        assert.equal(readWorkflowChoice('2', '20', s), null);
        assert.match([...s.map.keys()][0], /^slicerweb\./); // cleared on sign-out
    });
    it('keeps only the most recent 500', () => {
        const s = storage();
        for (let i = 0; i < 505; i += 1) saveWorkflowChoice('1', String(i), BUILTIN.FULL, s);
        assert.equal(readWorkflowChoice('1', '4', s), null);
        assert.equal(readWorkflowChoice('1', '5', s), BUILTIN.FULL);
        saveWorkflowChoice('1', '5', BUILTIN.SIMPLIFIED, s); // picking again makes it the newest
        saveWorkflowChoice('1', 'new', BUILTIN.FULL, s);
        assert.equal(readWorkflowChoice('1', '5', s), BUILTIN.SIMPLIFIED);
        assert.equal(readWorkflowChoice('1', '6', s), null);
    });
    it('survives unreadable or blocked storage', () => {
        const broken = { getItem: () => '{nope', setItem: () => { throw new Error('blocked'); } };
        assert.equal(readWorkflowChoice('1', '2', broken), null);
        assert.doesNotThrow(() => saveWorkflowChoice('1', '2', BUILTIN.FULL, broken));
    });
});
