import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { fakePayload } from './helpers/routeHarness.mjs';

/** fakePayload with a unique keycloak_sub, as the database enforces it. */
function payloadWithUniqueSub() {
    const payload = fakePayload();
    const create = payload.create.bind(payload);
    payload.create = async (args) => {
        const taken = (payload.rows[args.collection] || []).some((d) => d.keycloak_sub === args.data.keycloak_sub);
        if (taken) throw new Error('duplicate key value violates unique constraint');
        return create(args);
    };
    return payload;
}

let payload;
mock.module('../../../backend/src/payload/index.js', { namedExports: { getPayloadClient: () => payload } });

const { markBellOpened, getBellOpenedAt } = await import('../../../backend/src/services/notifications.js');
const { updatePreferencesByKcSub, hasCustomPreferences } = await import('../../../backend/src/services/payloadPreferences.js');

const rows = (collection) => payload.rows[collection] || [];

test.beforeEach(() => {
    payload = payloadWithUniqueSub();
});

test('opening the bell twice at once, with no record yet, makes one record and both succeed', async () => {
    const [first, second] = await Promise.all([markBellOpened('kc-a'), markBellOpened('kc-a')]);
    assert.ok(first && second);
    assert.equal(rows('bell-state').length, 1);
    assert.ok(await getBellOpenedAt('kc-a'));
});

test('saving preferences twice at once, with no record yet, makes one record', async () => {
    await Promise.all([
        updatePreferencesByKcSub('kc-a', { theme: 'dark' }),
        updatePreferencesByKcSub('kc-a', { theme: 'dark' }),
    ]);
    assert.equal(rows('user-preferences').length, 1);
    assert.equal(rows('user-preferences')[0].theme, 'dark');
});

test("opening the bell doesn't touch preferences, so a new account still counts as having none", async () => {
    await markBellOpened('kc-a');
    assert.equal(rows('user-preferences').length, 0);
    assert.equal(await hasCustomPreferences('kc-a'), false);
});
