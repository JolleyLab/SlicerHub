import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PRE_SYNC_DATA_MIGRATIONS,
    SLICER_WEB_CHANNEL_TO_DEFAULT,
    payloadWillPushSchema,
    applyPreSyncDataMigrations,
} from '../../../backend/src/payload/dataMigrations.js';

/** A connected pg client that records its queries; `failOn` makes a matching query throw. */
function fakeClient({ failOn } = {}) {
    const queries = [];
    return {
        queries,
        async query(sql) {
            queries.push(sql);
            if (failOn && sql.includes(failOn)) throw new Error('boom');
        },
    };
}

test('SlicerWeb channel migration only moves stable rows, and only before Default exists', () => {
    assert.ok(PRE_SYNC_DATA_MIGRATIONS.includes(SLICER_WEB_CHANNEL_TO_DEFAULT));
    assert.match(SLICER_WEB_CHANNEL_TO_DEFAULT, /SET slicer_web_channel = NULL WHERE slicer_web_channel = 'stable'/);
    assert.match(SLICER_WEB_CHANNEL_TO_DEFAULT, /NOT EXISTS[\s\S]*e\.enumlabel = 'default'/);
    assert.doesNotMatch(SLICER_WEB_CHANNEL_TO_DEFAULT, /'latest'/);
});

test('payloadWillPushSchema mirrors when Payload pushes its schema', () => {
    assert.equal(payloadWillPushSchema({ NODE_ENV: 'development' }), true);
    assert.equal(payloadWillPushSchema({}), true);
    assert.equal(payloadWillPushSchema({ NODE_ENV: 'production' }), false);
    assert.equal(payloadWillPushSchema({ NODE_ENV: 'development', PAYLOAD_MIGRATING: 'true' }), false);
});

test('applyPreSyncDataMigrations runs every statement in one transaction', async () => {
    const client = fakeClient();
    await applyPreSyncDataMigrations(client);
    assert.deepEqual(client.queries, ['BEGIN', ...PRE_SYNC_DATA_MIGRATIONS, 'COMMIT']);
});

test('applyPreSyncDataMigrations rolls back on failure', async () => {
    const client = fakeClient({ failOn: 'slicer_web_channel' });
    await assert.rejects(applyPreSyncDataMigrations(client), /boom/);
    assert.equal(client.queries.at(-1), 'ROLLBACK');
    assert.ok(!client.queries.includes('COMMIT'));
});
