import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEWER, viewerKey, viewerFromAccount, fileTypesOf, canRun, usableWorkflows, choiceFor, resolveOpen, shortList,
    opensInSlicer, uploadChoices,
    workflowsAddingExtensions,
} from '../../../dev/utils/openWith.js';

// GET /api/cases/:id/workflows, as the server sends it. Names are made up.
const W = (id, name, extensions, fileTypes = [], startupConfig = {}, viewer) => ({ id, name, extensions, fileTypes, startupConfig, viewer });
const DATA = {
    approved: [
        W(1, 'SlicerHeart', ['SlicerHeart']),
        W(2, 'SlicerHeart – Simplified', ['SlicerHeart'], [], { module: 'SimplifiedViewer' }, 'full'),
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

describe('workflowsAddingExtensions', () => {
    it('keeps the workflows that add an extension the launch did not have', () => {
        const { caseWorkflows } = usableWorkflows(DATA, { fileName: 'scan.mrb' });
        assert.deepEqual(keys(workflowsAddingExtensions(caseWorkflows)), ['case:1', 'case:2', 'case:3']);
        // SlicerHeart was already in: only Cardiac segmentation adds something
        assert.deepEqual(keys(workflowsAddingExtensions(caseWorkflows, ['SlicerHeart'])), ['case:3']);
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
    it('lists the plain viewers, then the case\'s workflows and mine that fit this file type', () => {
        const mrb = usableWorkflows(DATA, { fileName: 'heart.mrb' });
        assert.deepEqual(mrb.viewers, [VIEWER.SLICERWEB, VIEWER.FULL]);
        assert.deepEqual(keys(mrb.caseWorkflows), ['case:1', 'case:2', 'case:3']);
        assert.deepEqual(keys(mrb.mine), []);
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'a.seg.nrrd' }).caseWorkflows), ['case:1', 'case:2', 'case:4']);
        assert.deepEqual(keys(usableWorkflows(DATA, { fileName: 'brain.nii.gz' }).mine), ['mine:11']);
    });
    it('entries carry their viewer (SlicerWeb when none is given) and the icon the server sent', () => {
        const data = { ...DATA, approved: [{ ...DATA.approved[0], iconUrl: '/api/workflows/1/icon?v=a.png' }, DATA.approved[1]] };
        const [heart, simplified] = usableWorkflows(data, { fileName: 'heart.mrb' }).caseWorkflows;
        assert.deepEqual([heart.viewer, heart.iconUrl], [VIEWER.SLICERWEB, '/api/workflows/1/icon?v=a.png']);
        assert.deepEqual([simplified.viewer, simplified.iconUrl], [VIEWER.FULL, null]);
    });
    it('checks each workflow in its own viewer', () => {
        const data = {
            ...DATA,
            approved: [
                W(5, 'Simplified in SlicerWeb', ['SlicerHeart'], [], { module: 'SimplifiedViewer' }), // SlicerWeb can't start there
                W(6, 'RT in Full Slicer', ['SlicerRT'], [], {}, 'full'),                              // not in Full Slicer's manifest
                W(7, 'Heart in Full Slicer', ['SlicerHeart'], [], {}, 'full'),
            ],
        };
        assert.deepEqual(keys(usableWorkflows(data, { fileName: 'heart.mrb' }).caseWorkflows), ['case:7']);
    });
    it('the blank viewer is SlicerWeb only: its plain viewer and SlicerWeb workflows', () => {
        const blank = usableWorkflows(DATA);
        assert.deepEqual(blank.viewers, [VIEWER.SLICERWEB]);
        assert.deepEqual(keys(blank.caseWorkflows), ['case:1', 'case:3', 'case:4']);
    });
    it("one of mine the case has approved is listed only as the case's", () => {
        const data = { ...DATA, approved: [...DATA.approved, { ...W(7, 'My TAVR setup (approved)', ['SlicerRT'], ['nii.gz']), workflowId: 11 }] };
        const usable = usableWorkflows(data, { fileName: 'brain.nii.gz' });
        assert.deepEqual(keys(usable.caseWorkflows).includes('case:7'), true);
        assert.deepEqual(usable.mine, []);
    });
    it('personal workflows disappear when the case turns them off', () => {
        assert.deepEqual(usableWorkflows({ ...DATA, allowPersonal: false }, { fileName: 'b.nii.gz' }).mine, []);
    });
    it('before the case data has loaded: SlicerWeb only', () => {
        assert.deepEqual(usableWorkflows(null, { fileName: 'x.mrb' }), { viewers: [VIEWER.SLICERWEB], caseWorkflows: [], mine: [] });
    });
});

describe('choiceFor', () => {
    const usable = usableWorkflows(DATA, { fileName: 'heart.mrb' });
    it('a plain viewer opens with no workflow; a workflow opens in its own viewer', () => {
        assert.deepEqual(choiceFor(usable, viewerKey(VIEWER.FULL)), { key: 'viewer:full', viewer: VIEWER.FULL, workflow: null });
        const simplified = choiceFor(usable, 'case:2');
        assert.deepEqual([simplified.viewer, simplified.workflow.name], [VIEWER.FULL, 'SlicerHeart – Simplified']);
    });
    it("is null for what isn't offered", () => {
        assert.equal(choiceFor(usable, 'case:4'), null);
        assert.equal(choiceFor(usableWorkflows(DATA), viewerKey(VIEWER.FULL)), null); // the blank viewer
    });
});

describe('resolveOpen', () => {
    it('the case default, in its own viewer, whatever the account says', () => {
        const r = resolveOpen(DATA, { fileName: 'heart.mrb', accountViewer: 'full' });
        assert.deepEqual([r.key, r.viewer, r.from], ['case:1', VIEWER.SLICERWEB, 'default']);
        assert.equal(resolveOpen({ ...DATA, defaultWorkflow: '2' }, { fileName: 'heart.mrb' }).viewer, VIEWER.FULL);
    });
    it("the file's own default comes first; one that no longer applies is skipped", () => {
        const open = (fileDefault) => resolveOpen(DATA, { fileName: 'heart.mrb', fileDefault });
        assert.deepEqual([open('case:3').key, open('case:3').from], ['case:3', 'file']);
        assert.deepEqual([open('viewer:full').viewer, open('viewer:full').workflow], [VIEWER.FULL, null]);
        assert.equal(open('case:4').key, 'case:1'); // 4 is for .seg.nrrd: the case default instead
        assert.equal(open('case:99').key, 'case:1'); // removed from the case
    });
    it('with nothing usable: your account viewer, no workflow', () => {
        const r = resolveOpen({ ...DATA, defaultWorkflow: '4' }, { fileName: 'heart.mrb', accountViewer: 'full' });
        assert.deepEqual([r.key, r.viewer, r.workflow, r.from], ['viewer:full', VIEWER.FULL, null, 'none']);
    });
    it('the blank viewer is SlicerWeb, whatever the account says', () => {
        const r = resolveOpen({ ...DATA, defaultWorkflow: '2' }, { accountViewer: 'full' }); // 2 opens in Full Slicer
        assert.deepEqual([r.viewer, r.workflow], [VIEWER.SLICERWEB, null]);
    });
});

describe('uploads', () => {
    const data = { ...DATA, slicerFileTypes: ['mrb', 'nrrd', 'seg.nrrd', 'nii.gz'] };
    it('only files that open in Slicer are asked about', () => {
        assert.equal(opensInSlicer(data, 'Heart.SEG.nrrd'), true);
        assert.equal(opensInSlicer(data, 'report.pdf'), false);
        assert.equal(opensInSlicer(DATA, 'heart.mrb'), false); // the list hasn't loaded: not asked
    });
    it("offers the plain viewers and the case's toolkits for the file, not personal ones; the case default is chosen", () => {
        const { usable, selectedKey } = uploadChoices(data, { fileName: 'brain.nii.gz' });
        assert.deepEqual(usable.viewers, [VIEWER.SLICERWEB, VIEWER.FULL]);
        assert.deepEqual(keys(usable.caseWorkflows), ['case:1', 'case:2']);
        assert.deepEqual(usable.mine, []); // mine:11 fits .nii.gz, but others couldn't open with it
        assert.equal(selectedKey, 'case:1');
    });
    it('when the case default does not fit the file, SlicerWeb is chosen', () => {
        assert.equal(uploadChoices({ ...data, defaultWorkflow: '4' }, { fileName: 'heart.mrb' }).selectedKey, 'viewer:slicerweb');
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
