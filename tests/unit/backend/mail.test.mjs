import test from 'node:test';
import assert from 'node:assert/strict';
import { isMailConfigured, sendMail } from '../../../backend/src/services/mail.js';

test('isMailConfigured returns a boolean', () => {
    assert.equal(typeof isMailConfigured(), 'boolean');
});

test('sendMail returns sent:false when missing `to`', async () => {
    const result = await sendMail({ to: '', subject: 'Test', text: 'body' });
    assert.equal(result.sent, false);
    assert.ok(result.error);
});

test('sendMail returns sent:false when missing `subject`', async () => {
    const result = await sendMail({ to: 'test@example.com', subject: '', text: 'body' });
    assert.equal(result.sent, false);
    assert.ok(result.error);
});

test('sendMail returns sent:false when SMTP not configured', async () => {
    if (isMailConfigured()) {
        // SMTP is live in this env — skip rather than send a real email
        return;
    }
    const result = await sendMail({ to: 'test@example.com', subject: 'Test', text: 'body' });
    assert.equal(result.sent, false);
});

test('sendMail does not throw on missing message argument', async () => {
    const result = await sendMail(null);
    assert.equal(result.sent, false);
});
