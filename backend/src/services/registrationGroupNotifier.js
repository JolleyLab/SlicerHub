/**
 * Throttled email notifications to the registration approvers group.
 *
 * Two notification reasons exist with independent throttle windows:
 *   new_request  — fired when a registration arrives; max 1 per hour
 *   reminder     — for future use (e.g. 48h watchdog); max 1 per 24h
 *
 * State is in-memory: resets on restart. That is acceptable — the worst
 * case is one extra email immediately after a redeploy.
 */

import config from '../config/index.js';
import { getCapabilityGroupMembers, CAPABILITIES } from './groupCapabilities.js';
import { sendRegistrationPendingReviewEmail } from './mail.js';
import User from '../models/User.js';

const THROTTLE = {
    new_request: { ms: 60 * 60 * 1000,      lastAt: 0 }, // 1 hour
    reminder:    { ms: 24 * 60 * 60 * 1000, lastAt: 0 }, // 24 hours
};

function reviewUrl() {
    return `${(config.publicAppUrl || 'http://localhost:8000').replace(/\/+$/, '')}/?view=admin-registrations`;
}

async function _notify(reason) {
    const bucket = THROTTLE[reason];
    const now = Date.now();

    if (now - bucket.lastAt < bucket.ms) {
        return { sent: false, reason: 'throttled' };
    }

    let members;
    try {
        members = await getCapabilityGroupMembers(CAPABILITIES.APPROVE_REGISTRATIONS);
    } catch (err) {
        console.warn('[registration-notifier] Could not fetch approver group members:', err?.message);
        return { sent: false, reason: 'members_fetch_failed' };
    }

    // Filter out members with no email or who have opted out of email notifications.
    const recipients = members.filter(m => {
        if (!m.email) return false;
        const localUser = User.findByEmail(m.email);
        return localUser?.preferences?.notifyRegistrationApproval !== false;
    });
    if (!recipients.length) {
        return { sent: false, reason: 'no_members' };
    }

    // Stamp before sending so parallel calls don't race through the throttle gate.
    bucket.lastAt = now;

    const url = reviewUrl();
    const results = await Promise.allSettled(
        recipients.map(({ email, firstName }) =>
            sendRegistrationPendingReviewEmail({ to: email, firstName, reviewUrl: url })
        )
    );

    const sent = results.filter(r => r.status === 'fulfilled' && r.value?.sent).length;
    return { sent: true, recipients: recipients.length, delivered: sent };
}

/**
 * Call after a new registration is submitted.
 * Fire-and-forget — do not await; errors are logged internally.
 */
export async function notifyNewRequest() {
    try {
        return await _notify('new_request');
    } catch (err) {
        console.warn('[registration-notifier] notifyNewRequest failed:', err?.message);
        return { sent: false, reason: 'error' };
    }
}

/**
 * Future hook for a 48h reminder watchdog.
 * Wire up a scheduled check in server.js once that feature is built.
 * Independent throttle from notifyNewRequest — won't interfere with
 * the hourly gate even if a burst of new registrations recently went out.
 */
export async function sendReminder() {
    try {
        return await _notify('reminder');
    } catch (err) {
        console.warn('[registration-notifier] sendReminder failed:', err?.message);
        return { sent: false, reason: 'error' };
    }
}
