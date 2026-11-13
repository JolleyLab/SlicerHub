import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mocks } from './helpers/caseRouteMocks.mjs';
import { makeApp, dispatch } from './helpers/routeHarness.mjs';
import { ADMIN, MEMBER, STRANGER, seedWorkflows } from './helpers/workflowFixtures.mjs';

// In-memory storage, and multer replaced by a stand-in that takes req.body.upload as the file.
const stored = new Map(); // key -> Buffer
mock.module('../../../backend/src/storage/index.js', {
    defaultExport: {
        workflowIconKey: (id, version, ext) => `workflowIcons/${id}-${version}.${ext}`,
        write: async ({ key, buffer }) => { stored.set(key, buffer); },
        delete: async (key) => { stored.delete(key); },
        getPresignedReadUrl: async () => null,
        openReadStream: async (key) => ({ pipe: (res) => res.end(stored.get(key)) }),
    },
});
const upload = { tooLarge: false };
// The test lives outside backend/, so name backend's own copy of the package.
const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
mock.module(pathToFileURL(backendRequire.resolve('multer')).href, {
    defaultExport: Object.assign(() => ({
        single: () => (req, res, next) => {
            if (upload.tooLarge) return next(Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }));
            if (req.body.upload) req.file = { buffer: req.body.upload };
            next();
        },
    }), { memoryStorage: () => ({}) }),
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const { default: workflowRoutes, workflowFields } = await import('../../../backend/src/routes/workflows.js');
const { default: caseWorkflowRoutes } = await import('../../../backend/src/routes/caseWorkflows.js');

const app = makeApp();
workflowRoutes(app);
caseWorkflowRoutes(app);
const call = (method, path, opts) => dispatch(app, method, path, opts);

test.beforeEach(() => {
    stored.clear();
    upload.tooLarge = false;
    seedWorkflows();
});

// ── validation ──────────────────────────────────────────────────────────────

test('workflowFields validates and normalizes', () => {
    assert.deepEqual(
        workflowFields({ name: '  Cardiac ', extensions: ['SlicerHeart', 'SlicerHeart', ' SlicerRT '] }),
        { name: 'Cardiac', description: '', visibility: 'private', extensions: ['SlicerHeart', 'SlicerRT'], file_types: [], startup_config: {} },
    );
    assert.deepEqual(workflowFields({ visibility: 'public' }, { partial: true }), { visibility: 'public' });
    assert.throws(() => workflowFields({ name: '' }), /Name is required/);
    assert.throws(() => workflowFields({ name: 'x', visibility: 'everyone' }), /Visibility/);
    assert.throws(() => workflowFields({ name: 'x', extensions: 'SlicerHeart' }), /must be a list/);
    assert.throws(() => workflowFields({ name: 'x', extensions: ['../evil'] }), /invalid name/);
    assert.deepEqual(
        workflowFields({ fileTypes: ['*.MRB', '.nrrd', 'nhdr', 'mrb', 'seg.nrrd', 'nii.gz'] }, { partial: true }),
        { file_types: ['mrb', 'nrrd', 'nhdr', 'seg.nrrd', 'nii.gz'] },
    );
    assert.throws(() => workflowFields({ fileTypes: ['../etc'] }, { partial: true }), /File types has an invalid name/);
    assert.throws(() => workflowFields({ fileTypes: ['m r b'] }, { partial: true }), /invalid name/);
});

test('the startup configuration only takes known keys', () => {
    assert.deepEqual(workflowFields({ startupConfig: { module: ' SimplifiedViewer ' } }, { partial: true }), { startup_config: { module: 'SimplifiedViewer' } });
    assert.deepEqual(workflowFields({ startupConfig: { module: '' } }, { partial: true }), { startup_config: {} });
    assert.deepEqual(workflowFields({ startupConfig: null }, { partial: true }), { startup_config: {} });
    assert.equal('startup_config' in workflowFields({ name: 'x' }), true); // a new workflow always has one
    assert.throws(() => workflowFields({ startupConfig: { script: 'import os' } }, { partial: true }),
        (err) => err.messageKey === 'workflow.startup_config_key' && /include "script"/.test(err.message));
    assert.throws(() => workflowFields({ startupConfig: { module: 'Segment Editor' } }, { partial: true }), /invalid module/);
    assert.throws(() => workflowFields({ startupConfig: { module: '../x' } }, { partial: true }), /invalid module/);
    assert.throws(() => workflowFields({ startupConfig: ['module'] }, { partial: true }), /must be an object/);
});

test('approving copies the startup configuration; members see it', async () => {
    await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { startupConfig: { module: 'SimplifiedViewer' } } });
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.deepEqual(mocks.payload.rows['case-workflows'][0].startup_config, { module: 'SimplifiedViewer' });
    const [approved] = (await call('GET', '/api/cases/1/workflows', { user: MEMBER })).body.approved;
    assert.deepEqual(approved.startupConfig, { module: 'SimplifiedViewer' });
    assert.deepEqual((await call('GET', '/api/workflows/11', { user: STRANGER })).body.workflow.startupConfig, { module: 'SimplifiedViewer' });
});

// ── own workflows ──────────────────────────────────────────────────────────

test('create stores the owner and no viewer; list shows only mine', async () => {
    const created = await call('POST', '/api/workflows', { user: STRANGER, body: { name: 'Mine', extensions: ['SlicerIGT'] } });
    assert.equal(created.status, 201);
    assert.equal(created.body.workflow.isMine, true);
    const row = mocks.payload.rows.workflows.find((w) => w.name === 'Mine');
    assert.equal(row.owner_id, 'kc-stranger');
    assert.equal('target' in row, false);

    const list = await call('GET', '/api/workflows', { user: STRANGER });
    assert.deepEqual(list.body.workflows.map((w) => w.name), ['Mine']);
    assert.equal('owner_id' in list.body.workflows[0], false);
});

test('a user without a Keycloak identity cannot create workflows', async () => {
    const res = await call('POST', '/api/workflows', { user: { id: 9, role: 'user' }, body: { name: 'x' } });
    assert.equal(res.status, 403);
});

test('public workflows are viewable by anyone; private ones look missing', async () => {
    assert.equal((await call('GET', '/api/workflows/11', { user: STRANGER })).body.workflow.isMine, false);
    assert.equal((await call('GET', '/api/workflows/10', { user: STRANGER })).status, 404);
    assert.equal((await call('GET', '/api/workflows/10', { user: MEMBER })).body.workflow.name, 'WF 10');
});

test('only the owner can edit or delete', async () => {
    assert.equal((await call('PATCH', '/api/workflows/11', { user: STRANGER, body: { name: 'Hijack' } })).status, 403);
    assert.equal((await call('DELETE', '/api/workflows/11', { user: STRANGER })).status, 403);

    const edited = await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { visibility: 'private' } });
    assert.equal(edited.body.workflow.visibility, 'private');
    assert.equal(edited.body.workflow.name, 'WF 11');
    assert.equal((await call('DELETE', '/api/workflows/11', { user: MEMBER })).status, 204);
    assert.equal(mocks.payload.rows.workflows.some((w) => w.id === 11), false);
});

// ── case approvals ─────────────────────────────────────────────────────────

test('a case admin can approve a public workflow or their own private one, not someone else\'s private one', async () => {
    const pub = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal(pub.status, 201);
    assert.deepEqual(pub.body.approval.extensions, ['SlicerRT', 'SlicerHeart']);
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 12 } })).status, 201);
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 10 } })).status, 404);
});

test('collaborators cannot approve or remove', async () => {
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: MEMBER, body: { workflowId: 11 } })).status, 403);
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const [row] = mocks.payload.rows['case-workflows'];
    assert.equal((await call('DELETE', `/api/cases/1/workflows/${row.id}`, { user: MEMBER })).status, 403);
});

test('members see approved workflows plus their own; non-members are refused', async () => {
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const res = await call('GET', '/api/cases/1/workflows', { user: MEMBER });
    assert.deepEqual(res.body.approved.map((a) => a.name), ['WF 11']);
    assert.deepEqual(res.body.mine.map((w) => w.id), [10, 11]);
    assert.equal(res.body.canManage, false);
    assert.deepEqual(Object.keys(res.body.viewers), ['slicerweb', 'full']); // what each viewer can run
    assert.equal((await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.canManage, true);
    assert.equal((await call('GET', '/api/cases/1/workflows', { user: STRANGER })).status, 403);
});

test('the approved copy survives source edits and deletion; re-approving refreshes it', async () => {
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { extensions: ['SlicerIGT'] } });

    let approved = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved[0];
    assert.deepEqual(approved.extensions, ['SlicerRT', 'SlicerHeart']);
    assert.equal(approved.updateAvailable, true);

    const again = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    assert.equal(again.status, 200);
    assert.equal(mocks.payload.rows['case-workflows'].length, 1);
    approved = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved[0];
    assert.deepEqual(approved.extensions, ['SlicerIGT']);
    assert.equal(approved.updateAvailable, false);

    await call('DELETE', '/api/workflows/11', { user: MEMBER });
    approved = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved[0];
    assert.deepEqual(approved.extensions, ['SlicerIGT']);
});

test("edits the case doesn't copy aren't an update: visibility, or a copy from before startup configuration", async () => {
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { visibility: 'private' } });
    await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { visibility: 'public' } });
    let [approved] = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved;
    assert.equal(approved.updateAvailable, false);

    delete mocks.payload.rows['case-workflows'][0].startup_config; // approved before the field existed
    [approved] = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved;
    assert.equal(approved.updateAvailable, false);

    await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { startupConfig: { module: 'SimplifiedViewer' } } });
    [approved] = (await call('GET', '/api/cases/1/workflows', { user: ADMIN })).body.approved;
    assert.equal(approved.updateAvailable, true);
});

test('removing an approval only works within its own case', async () => {
    mocks.payload.rows.cases.push({ id: 2, title: 'Other', owner_id: 'kc-admin' });
    await call('POST', '/api/cases/2/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const [row] = mocks.payload.rows['case-workflows'];
    assert.equal((await call('DELETE', `/api/cases/1/workflows/${row.id}`, { user: ADMIN })).status, 404);
    assert.equal((await call('DELETE', `/api/cases/2/workflows/${row.id}`, { user: ADMIN })).status, 204);
    assert.equal(mocks.payload.rows['case-workflows'].length, 0);
});

test('approving copies what the menu needs and records the decision', async () => {
    mocks.payload.rows.workflows.find((w) => w.id === 11).file_types = ['mrb'];
    await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const [row] = mocks.payload.rows['case-workflows'];
    assert.equal(row.status, 'approved');
    assert.equal(row.decided_by, 'kc-admin');
    assert.deepEqual(row.file_types, ['mrb']);
    const [approved] = (await call('GET', '/api/cases/1/workflows', { user: MEMBER })).body.approved;
    assert.deepEqual(approved.fileTypes, ['mrb']);
    assert.equal('approved_by' in row, false);
});

test('rows that are not approved are not offered; rows without a status count as approved', async () => {
    mocks.payload.rows['case-workflows'] = [
        { id: 1, case: 1, workflow: '11', name: 'Old row', extensions: [] },
        { id: 2, case: 1, workflow: '12', name: 'Pending', status: 'pending', extensions: [] },
        { id: 3, case: 1, workflow: '10', name: 'Declined', status: 'declined', extensions: [] },
    ];
    const res = await call('GET', '/api/cases/1/workflows', { user: MEMBER });
    assert.deepEqual(res.body.approved.map((a) => a.name), ['Old row']);
});

// ── case settings ──────────────────────────────────────────────────────────

test('members get the default workflow; personal workflows are on unless the case turns them off', async () => {
    let res = await call('GET', '/api/cases/1/workflows', { user: MEMBER });
    assert.equal(res.body.defaultWorkflow, null);
    assert.equal(res.body.allowPersonal, true);

    await call('PATCH', '/api/cases/1/workflow-settings', { user: ADMIN, body: { allowPersonal: false } });
    res = await call('GET', '/api/cases/1/workflows', { user: MEMBER });
    assert.equal(res.body.allowPersonal, false);
    assert.deepEqual(res.body.mine, []);
});

test('only admins change settings; the default must be one of the case\'s approved workflows', async () => {
    assert.equal((await call('PATCH', '/api/cases/1/workflow-settings', { user: MEMBER, body: { allowPersonal: false } })).status, 403);
    const { body: { approval } } = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const patch = (body) => call('PATCH', '/api/cases/1/workflow-settings', { user: ADMIN, body });

    let res = await patch({ defaultWorkflow: approval.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.defaultWorkflow, String(approval.id));
    assert.equal((await call('GET', '/api/cases/1/workflows', { user: MEMBER })).body.defaultWorkflow, String(approval.id));

    res = await patch({ defaultWorkflow: '' });
    assert.equal(res.body.defaultWorkflow, null);

    const notInCase = await patch({ defaultWorkflow: '11' }); // a source workflow id, not this case's approval
    assert.equal(notInCase.status, 400);
    assert.equal(notInCase.error.messageKey, 'workflow.default_not_in_case');
    assert.equal((await patch({ defaultWorkflow: 'builtin:simplified' })).status, 400);
    assert.equal((await patch({ allowPersonal: 'no' })).error.messageKey, 'workflow.allow_personal_boolean');
});

test('a pending request cannot be the default', async () => {
    mocks.payload.rows['case-workflows'] = [{ id: 7, case: 1, workflow: '11', name: 'Pending', status: 'pending', extensions: [] }];
    assert.equal((await call('PATCH', '/api/cases/1/workflow-settings', { user: ADMIN, body: { defaultWorkflow: 7 } })).status, 400);
});

test('removing the default workflow clears the default; removing another leaves it', async () => {
    const { body: { approval: a } } = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 11 } });
    const { body: { approval: b } } = await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 12 } });
    await call('PATCH', '/api/cases/1/workflow-settings', { user: ADMIN, body: { defaultWorkflow: a.id } });

    await call('DELETE', `/api/cases/1/workflows/${b.id}`, { user: ADMIN });
    assert.equal(mocks.payload.rows.cases[0].default_workflow, String(a.id));
    await call('DELETE', `/api/cases/1/workflows/${a.id}`, { user: ADMIN });
    assert.equal(mocks.payload.rows.cases[0].default_workflow, null);
});

// ── browsing and approving from a list ─────────────────────────────────────

test('?scope=public lists everyone\'s public workflows, without owners', async () => {
    const res = await call('GET', '/api/workflows', { user: STRANGER, query: { scope: 'public' } });
    assert.deepEqual(res.body.workflows.map((w) => w.id), [11]);
    assert.equal(res.body.workflows[0].isMine, false);
    assert.equal('owner_id' in res.body.workflows[0], false);
});

// ── icons ──────────────────────────────────────────────────────────────────

test('the owner can upload an icon; it is stored and gets a versioned URL', async () => {
    const res = await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } });
    assert.equal(res.status, 200);
    const key = mocks.payload.rows.workflows.find((w) => w.id === 11).icon_key;
    assert.match(key, /^workflowIcons\/11-[a-z0-9]+\.png$/);
    assert.deepEqual(stored.get(key), PNG);
    assert.equal(res.body.workflow.iconUrl, `/api/workflows/11/icon?v=${key.split('/').pop()}`);
});

test('icons are checked by content: SVG or a renamed non-image is refused; too large is a 400', async () => {
    assert.equal((await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: SVG } })).status, 400);
    assert.equal((await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: {} })).status, 400);
    upload.tooLarge = true;
    assert.equal((await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } })).status, 400);
    assert.equal(stored.size, 0);
});

test('only the owner can change the icon; anyone who can see the workflow can see it', async () => {
    assert.equal((await call('PUT', '/api/workflows/11/icon', { user: STRANGER, body: { upload: PNG } })).status, 403);
    await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } });
    assert.equal((await call('DELETE', '/api/workflows/11/icon', { user: STRANGER })).status, 403);
    assert.equal((await call('GET', '/api/workflows/11/icon', { user: STRANGER })).status, 200); // public
    assert.equal((await call('GET', '/api/workflows/12/icon', { user: STRANGER })).status, 404); // private, someone else's
});

test('removing the icon, or the workflow, deletes the stored file', async () => {
    await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } });
    const res = await call('DELETE', '/api/workflows/11/icon', { user: MEMBER });
    assert.equal(res.body.workflow.iconUrl, null);
    assert.equal(stored.size, 0);

    await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } });
    await call('DELETE', '/api/workflows/11', { user: MEMBER });
    assert.equal(stored.size, 0);
});

test('a new upload replaces the old icon file and changes the URL; other edits leave the URL alone', async () => {
    const first = (await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } })).body.workflow.iconUrl;
    await new Promise((r) => setTimeout(r, 5));
    const second = (await call('PUT', '/api/workflows/11/icon', { user: MEMBER, body: { upload: PNG } })).body.workflow.iconUrl;
    assert.notEqual(second, first);
    assert.equal(stored.size, 1);
    const renamed = (await call('PATCH', '/api/workflows/11', { user: MEMBER, body: { name: 'Renamed' } })).body.workflow.iconUrl;
    assert.equal(renamed, second);
});

test('malformed ids are not found, without asking the database', async () => {
    for (const path of ['/api/workflows/abc', '/api/workflows/1.5', '/api/workflows/0']) {
        assert.equal((await call('GET', path, { user: MEMBER })).status, 404, path);
    }
    assert.equal((await call('GET', '/api/cases/x/workflows', { user: ADMIN })).status, 404);
    assert.equal((await call('DELETE', '/api/cases/1/workflows/zz', { user: ADMIN })).status, 404);
    assert.equal((await call('POST', '/api/cases/1/workflows', { user: ADMIN, body: { workflowId: 'nope' } })).status, 404);
});
