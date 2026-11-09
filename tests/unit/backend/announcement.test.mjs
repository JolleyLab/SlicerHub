import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// Site-wide banner (planned maintenance etc.) from the Payload `site-announcement` global.
mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});
mock.module('../../../backend/src/payload/index.js', {
    namedExports: { getPayloadClient: () => null }
});

const { activeAnnouncement } = await import('../../../backend/src/routes/announcement.js');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const at = (h) => new Date(NOW + h * 3600 * 1000).toISOString();

test('nothing shows unless enabled with a message', () => {
    assert.equal(activeAnnouncement(null, NOW), null);
    assert.equal(activeAnnouncement({ enabled: false, message: 'Hi' }, NOW), null);
    assert.equal(activeAnnouncement({ enabled: true, message: '   ' }, NOW), null);
    assert.deepEqual(activeAnnouncement({ enabled: true, message: ' Maintenance Saturday ' }, NOW),
        { message: 'Maintenance Saturday', severity: 'info' });
});

test('a planned notice shows only inside its window', () => {
    const row = { enabled: true, message: 'Down 9–11', severity: 'warning', starts_at: at(1), expires_at: at(3) };
    assert.equal(activeAnnouncement(row, NOW), null, 'before it starts');
    assert.deepEqual(activeAnnouncement(row, NOW + 2 * 3600 * 1000), { message: 'Down 9–11', severity: 'warning' });
    assert.equal(activeAnnouncement(row, NOW + 3 * 3600 * 1000), null, 'once it has ended');
});

test('an unknown severity falls back to info', () => {
    assert.equal(activeAnnouncement({ enabled: true, message: 'x', severity: 'shouting' }, NOW).severity, 'info');
});
