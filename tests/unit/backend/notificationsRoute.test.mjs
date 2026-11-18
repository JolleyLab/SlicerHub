import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeApp, dispatch, fakePayload } from './helpers/routeHarness.mjs';

// The bell: its dot is for notifications that are unread and not yet seen in an open bell.
let payload = null;
mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() },
});
mock.module('../../../backend/src/payload/index.js', {
    namedExports: { getPayloadClient: () => payload },
});

const { default: notificationRoutes } = await import('../../../backend/src/routes/notifications.js');
const { createNotification } = await import('../../../backend/src/services/notifications.js');

const app = makeApp();
notificationRoutes(app);
const ME = { id: 'kc-me', keycloakSub: 'kc-me' };
const OTHER = { id: 'kc-other' };
const call = (method, path, user = ME) => dispatch(app, method, path, { user });
const inbox = async (user = ME) => (await call('GET', '/api/notifications', user)).body;
const notify = (userId, title) => createNotification({ userId, type: 'info', title });

test.beforeEach(() => { payload = fakePayload({ 'user-notifications': [] }); });

test('opening the bell clears its dot, and the notifications stay unread', async () => {
    await notify('kc-me', 'One');
    await notify('kc-me', 'Two');
    assert.deepEqual(await inbox().then(({ unreadCount, newCount }) => ({ unreadCount, newCount })), { unreadCount: 2, newCount: 2 });

    const { bellOpenedAt, ...seen } = (await call('POST', '/api/notifications/seen')).body;
    assert.deepEqual(seen, { ok: true, seen: 2, newCount: 0 });
    assert.ok(bellOpenedAt);
    const after = await inbox();
    assert.equal(after.newCount, 0);
    assert.equal(after.unreadCount, 2);
    assert.ok(after.notifications.every((n) => n.read_at === null && n.seen_at));
});

test('a notification arriving after the bell was opened shows the dot again', async () => {
    await notify('kc-me', 'Seen');
    await call('POST', '/api/notifications/seen');
    await notify('kc-me', 'New');
    assert.equal((await inbox()).newCount, 1);
});

test('read notifications never count, and seeing only touches your own', async () => {
    await notify('kc-me', 'Read');
    const [read] = (await inbox()).notifications;
    await call('POST', `/api/notifications/${read.id}/read`);
    assert.equal((await inbox()).newCount, 0);

    await notify('kc-other', 'Theirs');
    assert.equal((await call('POST', '/api/notifications/seen')).body.seen, 0);
    assert.equal((await inbox(OTHER)).newCount, 1);
});

test('opening the bell records when, across browsers, so older to-dos stop lighting the dot', async () => {
    assert.equal((await inbox()).bellOpenedAt, null);
    const opened = (await call('POST', '/api/notifications/seen')).body.bellOpenedAt;
    assert.equal((await inbox()).bellOpenedAt, opened);
    assert.equal(payload.rows['user-preferences'].length, 1);

    // Opening again updates the same record.
    await call('POST', '/api/notifications/seen');
    assert.equal(payload.rows['user-preferences'].length, 1);
    assert.equal((await inbox(OTHER)).bellOpenedAt, null);
});
