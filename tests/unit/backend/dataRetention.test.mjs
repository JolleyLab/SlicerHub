import test from 'node:test';
import assert from 'node:assert/strict';

// Retention sweep: personal data that has served its purpose is removed on a schedule.
const { runRetentionSweep } = await import('../../../backend/src/services/dataRetention.js');

const NOW = Date.parse('2026-11-05T12:00:00Z');
const daysBefore = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

function fakePayload({ failOn } = {}) {
    const calls = [];
    const record = (op) => async (args) => {
        calls.push({ op, ...args });
        if (failOn === args.collection) throw new Error('boom');
        return { docs: [] };
    };
    return { calls, delete: record('delete'), update: record('update') };
}

test('the password-reset token store is gone: nothing is swept there', async () => {
    const payload = fakePayload();
    await runRetentionSweep(payload, { now: NOW });
    assert.equal(payload.calls.some((c) => c.collection === 'password-reset-tokens'), false);
});

test('only rejected or expired invites are deleted, after 30 days', async () => {
    const payload = fakePayload();
    await runRetentionSweep(payload, { now: NOW });
    const call = payload.calls.find((c) => c.collection === 'case-invites');
    assert.deepEqual(call.where, {
        and: [
            { status: { in: ['rejected', 'expired'] } },
            { updatedAt: { less_than: daysBefore(30) } },
        ],
    });
});

test('registration requests: rejected and old-flow approved ones deleted after 30 days, completed ones stripped of free text', async () => {
    const payload = fakePayload();
    await runRetentionSweep(payload, { now: NOW });
    const reg = payload.calls.filter((c) => c.collection === 'registration-requests');

    const deletes = reg.filter((c) => c.op === 'delete');
    assert.equal(deletes.length, 2);
    assert.deepEqual(deletes[0].where.and[0], { status: { equals: 'rejected' } });
    assert.deepEqual(deletes[1].where, {
        and: [
            { status: { equals: 'approved' } },
            { updatedAt: { less_than: daysBefore(30) } },
        ],
    });

    const update = reg.find((c) => c.op === 'update');
    assert.deepEqual(update.where.and[0], { status: { equals: 'completed' } });
    assert.deepEqual(update.data, { affiliation: '', intended_use: '' });
    // Nothing pending is touched.
    assert.equal(JSON.stringify(reg).includes('"pending"'), false);
});

test('one failing step does not stop the others', async () => {
    const payload = fakePayload({ failOn: 'case-invites' });
    const original = console.warn;
    console.warn = () => {};
    try {
        await runRetentionSweep(payload, { now: NOW });
    } finally {
        console.warn = original;
    }
    assert.ok(payload.calls.some((c) => c.collection === 'registration-requests'));
    assert.ok(payload.calls.some((c) => c.collection === 'user-notifications'));
});

test('does nothing when Payload is not configured', async () => {
    await assert.doesNotReject(runRetentionSweep(null));
});
