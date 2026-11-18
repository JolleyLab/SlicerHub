import test from 'node:test';
import assert from 'node:assert/strict';
import { mocks } from './helpers/caseRouteMocks.mjs';
import { fakePayload } from './helpers/routeHarness.mjs';

const { ensureSeedWorkflows, seedExistingCases, seedWorkflows, SYSTEM_OWNER } = await import('../../../backend/src/setup/workflowSeed.js');

const rows = (collection) => mocks.payload.rows[collection] || [];
const caseRows = (caseId) => rows('case-workflows').filter((r) => String(r.case) === String(caseId));

test.beforeEach(() => {
    mocks.reset(fakePayload({
        cases: [
            { id: 1, title: 'From before workflows', owner_id: 'kc-a' },
            { id: 2, title: 'Also old', owner_id: 'kc-b', workflows_seeded: false },
            { id: 3, title: 'Created after', owner_id: 'kc-a', workflows_seeded: true },
        ],
        workflows: [],
    }));
});

test('creates the two public SlicerHeart workflows once, owned by no person', async () => {
    const [heart, simplified] = await ensureSeedWorkflows();
    assert.equal(heart.name, 'SlicerHeart');
    assert.deepEqual(heart.startup_config, {});
    assert.equal(simplified.name, 'SlicerHeart – Simplified');
    assert.deepEqual(simplified.startup_config, { module: 'SimplifiedViewer' });
    for (const w of [heart, simplified]) {
        assert.equal(w.owner_id, SYSTEM_OWNER);
        assert.equal(w.visibility, 'public');
        assert.deepEqual(w.extensions, ['SlicerHeart']);
    }
    await ensureSeedWorkflows();
    assert.equal(rows('workflows').length, 2);
});

test('cases from before workflows get both approved and SlicerHeart as default; new cases are left alone', async () => {
    const seeds = await ensureSeedWorkflows();
    assert.equal(await seedExistingCases(seeds), 2);

    for (const caseId of [1, 2]) {
        const approved = caseRows(caseId);
        assert.deepEqual(approved.map((r) => [r.name, r.status]), [['SlicerHeart', 'approved'], ['SlicerHeart – Simplified', 'approved']]);
        const caseDoc = rows('cases').find((c) => c.id === caseId);
        assert.equal(caseDoc.default_workflow, String(approved[0].id));
        assert.equal(caseDoc.workflows_seeded, true);
    }
    assert.deepEqual(caseRows(3), []);
    assert.equal(rows('cases').find((c) => c.id === 3).default_workflow, undefined);
});

test('runs once per case: what an admin removes later stays removed', async () => {
    const seeds = await ensureSeedWorkflows();
    await seedExistingCases(seeds);
    mocks.payload.rows['case-workflows'] = rows('case-workflows').filter((r) => String(r.case) !== '1');
    rows('cases').find((c) => c.id === 1).default_workflow = null;

    assert.equal(await seedExistingCases(seeds), 0);
    assert.deepEqual(caseRows(1), []);
});

test('keeps a default the case already has, and approves a seed that was only requested', async () => {
    const seeds = await ensureSeedWorkflows();
    const caseDoc = rows('cases').find((c) => c.id === 1);
    caseDoc.default_workflow = '77';
    mocks.payload.rows['case-workflows'] = [{ id: 50, case: 1, workflow: String(seeds[1].id), name: 'x', status: 'pending' }];
    mocks.payload.rows['case-workflow-requesters'] = [{ id: 60, case: 1, workflow: String(seeds[1].id), user_sub: 'kc-b' }];

    await seedExistingCases(seeds);
    assert.equal(caseDoc.default_workflow, '77');
    const simplifiedRow = caseRows(1).find((r) => r.workflow === String(seeds[1].id));
    assert.equal(simplifiedRow.id, 50);
    assert.equal(simplifiedRow.status, 'approved');
    assert.deepEqual(rows('case-workflow-requesters'), []); // the request is met: nobody is kept as asking
});

test('reports what it did for setup-payload, and doing it again changes nothing', async () => {
    assert.deepEqual(await seedWorkflows(), { workflows: ['SlicerHeart', 'SlicerHeart – Simplified'], cases: 2 });
    assert.deepEqual(await seedWorkflows(), { workflows: ['SlicerHeart', 'SlicerHeart – Simplified'], cases: 0 });
    assert.equal(rows('workflows').length, 2);
    // Created through Payload, so the search hook gave them their search text.
    assert.ok(rows('workflows').every((w) => w.search_text.includes('slicerheart')));
});

test('a failure reaches setup-payload, which stops and says so', async () => {
    mocks.payload.find = async () => { throw new Error('database down'); };
    await assert.rejects(seedWorkflows(), /database down/);
});
