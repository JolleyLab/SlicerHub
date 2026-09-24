import test from 'node:test';
import assert from 'node:assert/strict';
import { UploadManager, UPLOAD_STATUS as S } from '../../../dev/services/uploadManager.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (name, size = 1000) => ({ name, size, type: 'application/octet-stream' });
const statuses = (manager) => manager.list().map((job) => job.status);

/** A manager wired to a fake uploader the test resolves by hand. */
function harness({ attachFails = () => false } = {}) {
    const uploads = [];
    const attaches = [];
    let clock = 0;
    const manager = new UploadManager({
        now: () => clock,
        upload: (f, { onProgress, signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            uploads.push({
                file: f,
                onProgress,
                signal,
                finish: (token = `token-${uploads.length}`) => resolve({ uploadToken: token }),
                fail: reject
            });
        }),
        attach: async (caseId, payload) => {
            attaches.push({ caseId, ...payload });
            if (attachFails()) throw new Error('attach failed');
            return { id: `attachment-${attaches.length}`, name: payload.name };
        }
    });
    return { manager, uploads, attaches, setClock: (ms) => { clock = ms; } };
}

test('uploads one file at a time, in order', async () => {
    const { manager, uploads } = harness();
    manager.enqueue({ caseId: 'c1', files: [file('a'), file('b')] });
    await tick();
    assert.deepEqual(statuses(manager), [S.UPLOADING, S.QUEUED]);
    uploads[0].finish();
    await tick();
    assert.equal(uploads.length, 2, 'the second upload starts once the first is done');
});

test('a finished upload waits for the details step before it attaches', async () => {
    const { manager, uploads, attaches } = harness();
    const events = [];
    manager.addEventListener('attached', (e) => events.push(e.detail));
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('scan.nrrd', 5000)] });
    await tick();
    uploads[0].finish('tok-1');
    await tick();

    assert.deepEqual(statuses(manager), [S.AWAITING_DETAILS]);
    assert.equal(attaches.length, 0);

    manager.updateDetails(job.id, { name: '  Baseline CT  ' });
    manager.resolveDetails([job.id]);
    await tick();

    assert.equal(attaches[0].name, 'Baseline CT');
    assert.equal(attaches[0].uploadToken, 'tok-1');
    assert.deepEqual(statuses(manager), [S.DONE]);
    assert.equal(events.length, 1);
    assert.equal(events[0].caseId, 'c1');
});

test('details confirmed during the upload attach as soon as it finishes; a blank name keeps the file name', async () => {
    const { manager, uploads, attaches } = harness();
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('x.nii.gz')] });
    await tick();
    manager.updateDetails(job.id, { name: '   ' });
    manager.resolveDetails([job.id]);
    uploads[0].finish();
    await tick();
    assert.equal(attaches[0].name, 'x.nii.gz');
});

test('announces the batch so the UI can ask for details', () => {
    const { manager } = harness();
    let detail;
    manager.addEventListener('details-requested', (e) => { detail = e.detail; });
    const jobs = manager.enqueue({ caseId: 'c1', files: [file('a'), file('b')] });
    assert.deepEqual(detail.jobIds, jobs.map((job) => job.id));
});

test('tracks rate, time remaining and per-case progress; throttles change events', async () => {
    const { manager, uploads, setClock } = harness();
    manager.enqueue({ caseId: 'c1', files: [file('big', 10_000_000)] });
    await tick();
    setClock(0); uploads[0].onProgress(0, 10_000_000);
    setClock(1000); uploads[0].onProgress(1_000_000, 10_000_000);
    setClock(2000); uploads[0].onProgress(2_000_000, 10_000_000);

    const [job] = manager.list();
    assert.ok(Math.abs(job.rate - 1_000_000) < 1);
    assert.ok(Math.abs(job.eta - 8) < 0.01);
    assert.ok(Math.abs(manager.summary('c1').progress - 0.2) < 1e-9);
    assert.equal(manager.summary('another-case').count, 0);

    let changes = 0;
    manager.addEventListener('change', () => { changes += 1; });
    for (let i = 0; i < 50; i += 1) uploads[0].onProgress(2_000_000 + i, 10_000_000);
    assert.ok(changes <= 1, `${changes} change events for 50 progress events in the same instant`);
});

test('cancelling an upload aborts it and lets the queue move on', async () => {
    const { manager, uploads } = harness();
    const [first] = manager.enqueue({ caseId: 'c1', files: [file('a'), file('b')] });
    await tick();
    manager.cancel(first.id);
    await tick();
    assert.ok(uploads[0].signal.aborted);
    assert.deepEqual(statuses(manager), [S.CANCELED, S.UPLOADING]);
});

test('retry after a failed upload uploads again', async () => {
    const { manager, uploads } = harness();
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('a')] });
    await tick();
    uploads[0].fail(Object.assign(new Error('boom'), { status: 503 }));
    await tick();
    assert.equal(manager.list()[0].errorStage, 'upload');
    manager.retry(job.id);
    await tick();
    assert.equal(uploads.length, 2);
});

test('retry after a failed attach does not upload the bytes again', async () => {
    let failOnce = true;
    const { manager, uploads, attaches } = harness({ attachFails: () => { const fail = failOnce; failOnce = false; return fail; } });
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('a')] });
    await tick();
    manager.resolveDetails([job.id]);
    uploads[0].finish('tok-9');
    await tick();
    assert.equal(manager.list()[0].errorStage, 'attach');

    manager.retry(job.id);
    await tick();
    assert.equal(uploads.length, 1, 'no second upload');
    assert.equal(attaches.length, 2);
    assert.deepEqual(statuses(manager), [S.DONE]);
});

test('active jobs (including one waiting for details) block dismissal and count as active', async () => {
    const { manager, uploads } = harness();
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('a')] });
    await tick();
    uploads[0].finish();
    await tick();

    assert.ok(manager.hasActive());
    assert.ok(manager.summary('c1').awaitingDetails);
    manager.dismiss(job.id);
    assert.equal(manager.list().length, 1, 'an active job cannot be dismissed');

    manager.cancelAll();
    assert.equal(manager.hasActive(), false);
    manager.dismiss(job.id);
    assert.equal(manager.list().length, 0);
});

test('finished jobs stay until dismissed: nothing removes them on a timer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { manager, uploads } = harness();
    const [job] = manager.enqueue({ caseId: 'c1', files: [file('a')] });
    manager.resolveDetails([job.id]);
    uploads[0].finish();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(statuses(manager), [S.DONE]);

    t.mock.timers.tick(10 * 60 * 1000);
    assert.deepEqual(statuses(manager), [S.DONE], 'still listed ten minutes later');
});

test('dismissFinished clears finished and canceled jobs but keeps failed ones (they offer a retry)', async () => {
    const { manager, uploads } = harness();
    const [done, failed, canceled, active] = manager.enqueue({ caseId: 'c1', files: [file('a'), file('b'), file('c'), file('d')] });
    manager.resolveDetails([done.id]);
    await tick(); uploads[0].finish(); await tick();                       // a -> done
    uploads[1].fail(Object.assign(new Error('boom'), { status: 503 })); await tick();   // b -> error
    manager.cancel(canceled.id); await tick();                             // c canceled
    await tick();                                                          // d is now uploading

    manager.dismissFinished();
    assert.deepEqual(manager.list().map((job) => job.id).sort(), [failed.id, active.id].sort());
    assert.equal(manager.list().find((job) => job.id === failed.id).status, S.ERROR);
});
