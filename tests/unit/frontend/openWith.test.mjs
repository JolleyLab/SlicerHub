import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEWER, NO_WORKFLOW, viewerFromAccount, fileTypesOf, canRun, usableWorkflows, resolveOpen, shortList,
    readOpenPick, saveOpenPick,
} from '../../../dev/utils/openWith.js';

// GET /api/cases/:id/workflows, as the server sends it. Names are made up.
const W = (id, name, extensions, fileTypes = [], startupConfig = {}) => ({ id, name, extensions, fileTypes, startupConfig });
const DATA = {
    approved: [
        W(1, 'SlicerHeart', ['SlicerHeart']),
        W(2, 'SlicerHeart – Simplified', ['SlicerHeart'], [], { module: 'SimplifiedViewer' }),
        W(3, 'Cardiac segmentation', ['SlicerHeart', 'SegmentEditorExtraEffects'], ['mrb']),
        W(4, 'Segment review', ['SegmentEditorExtraEffects'], ['seg.nrrd']),
    ],
    mine: [W(11, 'My TAVR setup', ['SlicerRT'], ['nii.gz'])],
    allowPersonal: true,
    defaultWorkflow: '1',
    viewers: {
        slicerweb: { startupKeys: ['module'], unsupportedModules: ['SimplifiedViewer'] },
        full: { extensions: ['Sandbox', 'SlicerHeart'], startupKeys: ['module'], unsupportedModules: [] },
    },
};
const keys = (list) => list.map((e) => e.key);

describe('viewerFromAccount', () => {
    it('maps the account setting; Simplified is a workflow now, so it means Full Slicer', () => {
        assert.equal(viewerFromAccount('web'), VIEWER.SLICERWEB);
        assert.equal(viewerFromAccount(undefined), VIEWER.SLICERWEB);
        assert.equal(viewerFromAccount('full'), VIEWER.FULL);
        assert.equal(viewerFromAccount('simplified'), VIEWER.FULL);
    });
});

describe('fileTypesOf', () => {
    it('lists every suffix, longest first, lowercase', () => {
        assert.deepEqual(fileTypesOf('Heart.SEG.nrrd'), ['seg.nrrd', 'nrrd']);
        assert.deepEqual(fileTypesOf('README'), []);
    });
});

describe('canRun', () => {
    const opts = { viewers: DATA.viewers, slicerWebExtensions: ['SlicerHeart', 'SegmentEditorExtraEffects', 'SlicerRT'] };
    const [heart, simplified, cardiac] = DATA.approved;
    it('SlicerWeb runs what its build has, with the startup keys it supports', () => {
        assert.equal(canRun(heart, VIEWER.SLICERWEB, opts), true);
        assert.equal(canRun(cardiac, VIEWER.SLICERWEB, opts), true);
        assert.equal(canRun(W(9, 'x', ['NotInBuild']), VIEWER.SLICERWEB, opts), false);
    });
    it("leaves out a start module the viewer can't start in (SimplifiedViewer in SlicerWeb)", () => {
        assert.equal(canRun(simplified, VIEWER.SLICERWEB, opts), false);
        const fixed = { ...DATA.viewers, slicerweb: { startupKeys: ['module'], unsupportedModules: [] } };
        assert.equal(canRun(simplified, VIEWER.SLICERWEB, { ...opts, viewers: fixed }), true);
    });
    it('while the build list is unknown, SlicerWeb counts as having everything', () => {
        assert.equal(canRun(W(9, 'x', ['NotInBuild']), VIEWER.SLICERWEB, { viewers: DATA.viewers }), true);
    });
    it('Full Slicer runs what its manifest has, with a start module', () => {
        assert.equal(canRun(heart, VIEWER.FULL, opts), true);
        assert.equal(canRun(simplified, VIEWER.FULL, opts), true);
        assert.equal(canRun(cardiac, VIEWER.FULL, opts), false); // SegmentEditorExtraEffects isn't in the manifest
        const noKeys = { ...DATA.viewers, full: { extensions: ['SlicerHeart'], startupKeys: [] } };
        assert.equal(canRun(simplified, VIEWER.FULL, { viewers: noKeys }), false);
    });
    it('without viewer data, only SlicerWeb', () => {
        assert.equal(canRun(heart, VIEWER.SLICERWEB), true);
        assert.equal(canRun(heart, VIEWER.FULL), false);
    });
});

describe('usableWorkflows', () => {
    it('lists the case\'s workflows then mine, for this file type, in this viewer', () => {
        const mrb = usableWorkflows(DATA, { fileName: 'heart.mrb' });
        assert.deepEqual(keys(mrb.caseWorkflows), ['case:1', 'case:3']); // 2 starts in SimplifiedViewer
        assert.deepEqual(keys(mrb.mine), []);
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'a.seg.nrrd' }).caseWorkflows), ['case:1', 'case:4']);
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'brain.nii.gz' }).mine), ['mine:11']);
    });
    it('hides what the viewer can\'t run', () => {
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'heart.mrb', viewer: VIEWER.FULL }).caseWorkflows), ['case:1', 'case:2']);
    });
    it('the blank viewer lists every workflow', () => {
        assert.equal(usableWorkflows(DATA).caseWorkflows.length, 3); // all but the SimplifiedViewer one
    });
    it("one of mine the case has approved is listed only as the case's", () => {
        const data = { ...DATA, approved: [...DATA.approved, { ...W(7, 'My TAVR setup (approved)', ['SlicerRT'], ['nii.gz']), workflowId: 11 }] };
        const usable = usableWorkflows(data, { fileName: 'brain.nii.gz' });
        assert.deepEqual(keys(usable.caseWorkflows).includes('case:7'), true);
        assert.deepEqual(usable.mine, []);
    });
    it('a public workflow of mine that the case has not approved stays under Mine', () => {
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'brain.nii.gz' }).mine), ['mine:11']);
    });
    it('personal workflows disappear when the case turns them off', () => {
        assert.deepEqual(usableWorkflows({ ...DATA, allowPersonal: false }, { fileName: 'b.nii.gz' }).mine, []);
    });
    it('works before the case data has loaded', () => {
        assert.deepEqual(usableWorkflows(null, { fileName: 'x.mrb' }), { caseWorkflows: [], mine: [] });
    });
});

describe('resolveOpen', () => {
    const open = (fileName, pick, accountViewer = 'web') => resolveOpen(DATA, { fileName, pick, accountViewer });
    it('with no pick: your account viewer and the case default', () => {
        const r = open('heart.mrb', null);
        assert.equal(r.viewer, VIEWER.SLICERWEB);
        assert.equal(r.workflow.key, 'case:1');
        assert.equal(r.from, 'default');
    });
    it('your pick for this file wins, for the workflow and the viewer separately', () => {
        assert.equal(open('heart.mrb', { workflow: 'case:3' }).workflow.key, 'case:3');
        assert.equal(open('heart.mrb', { workflow: NO_WORKFLOW }).workflow, null);
        assert.equal(open('heart.mrb', { viewer: VIEWER.FULL }).viewer, VIEWER.FULL);
        assert.equal(open('heart.mrb', { viewer: VIEWER.SLICERWEB }, 'full').viewer, VIEWER.SLICERWEB);
    });
    it('a pick or default that can\'t be used here is skipped', () => {
        assert.equal(open('heart.mrb', { workflow: 'case:4' }).workflow.key, 'case:1'); // 4 is for .seg.nrrd
        assert.equal(open('heart.mrb', { workflow: 'case:99' }).workflow.key, 'case:1'); // removed from the case
        const full = open('heart.mrb', { workflow: 'case:3' }, 'full');                  // Full Slicer can't run 3
        assert.equal(full.viewer, VIEWER.FULL);
        assert.equal(full.workflow.key, 'case:1');
        const noDefault = resolveOpen({ ...DATA, defaultWorkflow: '4' }, { fileName: 'heart.mrb' });
        assert.deepEqual([noDefault.workflow, noDefault.from], [null, 'none']);
    });
    it('the blank viewer is always SlicerWeb', () => {
        assert.equal(resolveOpen(DATA, { pick: { viewer: VIEWER.FULL }, accountViewer: 'full' }).viewer, VIEWER.SLICERWEB);
    });
    it('ignores a stored viewer it doesn\'t know', () => {
        assert.equal(open('heart.mrb', { viewer: 'simplified' }).viewer, VIEWER.SLICERWEB);
    });
});

describe('shortList', () => {
    const many = {
        caseWorkflows: Array.from({ length: 6 }, (_, i) => ({ key: `case:${i}` })),
        mine: [{ key: 'mine:1' }],
    };
    it('shows the first five and counts the rest', () => {
        const list = shortList(many);
        assert.deepEqual(keys(list.caseWorkflows), ['case:0', 'case:1', 'case:2', 'case:3', 'case:4']);
        assert.deepEqual(list.mine, []);
        assert.equal(list.hidden, 2);
    });
    it('keeps the selected one visible', () => {
        const list = shortList(many, 'mine:1');
        assert.deepEqual(keys(list.mine), ['mine:1']);
        assert.equal(list.caseWorkflows.length, 4);
        assert.equal(list.hidden, 2);
    });
    it('nothing hidden when it fits', () => {
        assert.equal(shortList({ caseWorkflows: [{ key: 'case:1' }], mine: [] }).hidden, 0);
    });
});

describe('picks', () => {
    const storage = () => {
        const map = new Map();
        return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map };
    };
    it('keeps the viewer and workflow picks for a file together', () => {
        const s = storage();
        saveOpenPick('1', '20', { viewer: VIEWER.FULL }, s);
        saveOpenPick('1', '20', { workflow: 'case:3' }, s);
        assert.deepEqual(readOpenPick('1', '20', s), { viewer: VIEWER.FULL, workflow: 'case:3' });
        assert.equal(readOpenPick('1', null, s), null);
        assert.match([...s.map.keys()][0], /^slicerweb\./); // cleared on sign-out
    });
    it('keeps only the most recent 500 files', () => {
        const s = storage();
        for (let i = 0; i < 502; i += 1) saveOpenPick('1', String(i), { workflow: NO_WORKFLOW }, s);
        assert.equal(readOpenPick('1', '1', s), null);
        assert.deepEqual(readOpenPick('1', '2', s), { workflow: NO_WORKFLOW });
    });
    it('survives unreadable or blocked storage, and says so once per page load', (t) => {
        const warn = t.mock.method(console, 'warn', () => {});
        const broken = { getItem: () => '[1]', setItem: () => { throw new Error('blocked'); } };
        assert.equal(readOpenPick('1', '2', broken), null);
        assert.doesNotThrow(() => saveOpenPick('1', '2', { viewer: VIEWER.FULL }, broken));
        saveOpenPick('1', '3', { viewer: VIEWER.FULL }, broken);
        const messages = warn.mock.calls.map((c) => c.arguments[0]);
        assert.deepEqual(messages, [
            "[openWith] couldn't read per-file picks; files will open with their defaults:",
            "[openWith] couldn't save per-file picks; files will open with their defaults:",
        ]);
    });
});
