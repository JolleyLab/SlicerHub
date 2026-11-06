/**
 * Retention sweep for personal data in Payload that has served its purpose.
 *
 *   case-invites           — rejected/expired ones deleted after 30 days (an expired
 *                            invite's unused account is removed at expiry,
 *                            services/inviteExpiry.js)
 *   registration-requests  — rejected ones (and old-flow 'approved' ones) deleted after
 *                            30 days; completed ones lose affiliation/intended-use
 *                            30 days on
 *                            (reviewers' "recently decided" list only looks back 7 days)
 *   user-notifications     — read ones deleted after 30 days, all after 90 (they carry
 *                            case titles and comment excerpts)
 *
 * Runs at startup and every few hours (server.js). Each step is independent so one
 * failure doesn't stop the rest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION = Object.freeze({
    closedInviteDays: 30,
    registrationDays: 30,
    readNotificationDays: 30,
    notificationDays: 90,
});

function daysAgo(now, days) {
    return new Date(now - days * DAY_MS).toISOString();
}

/**
 * @param {import('payload').Payload} payload
 * @param {{ now?: number }} [opts]
 */
export async function runRetentionSweep(payload, { now = Date.now() } = {}) {
    if (!payload) return;

    const steps = [
        ['rejected/expired case invites', () => payload.delete({
            collection: 'case-invites',
            where: {
                and: [
                    { status:    { in: ['rejected', 'expired'] } },
                    { updatedAt: { less_than: daysAgo(now, RETENTION.closedInviteDays) } },
                ],
            },
        })],
        ['rejected registration requests', () => payload.delete({
            collection: 'registration-requests',
            where: {
                and: [
                    { status:    { equals: 'rejected' } },
                    { updatedAt: { less_than: daysAgo(now, RETENTION.registrationDays) } },
                ],
            },
        })],
        // 'approved' is only on records from the old app-run sign-up, whose completion
        // link no longer works.
        ['old-flow approved registration requests', () => payload.delete({
            collection: 'registration-requests',
            where: {
                and: [
                    { status:    { equals: 'approved' } },
                    { updatedAt: { less_than: daysAgo(now, RETENTION.registrationDays) } },
                ],
            },
        })],
        ['completed registration request details', () => payload.update({
            collection: 'registration-requests',
            where: {
                and: [
                    { status:    { equals: 'completed' } },
                    { updatedAt: { less_than: daysAgo(now, RETENTION.registrationDays) } },
                    { or: [
                        { affiliation:  { not_equals: '' } },
                        { intended_use: { not_equals: '' } },
                    ] },
                ],
            },
            data: { affiliation: '', intended_use: '' },
        })],
        ['old notifications', () => payload.delete({
            collection: 'user-notifications',
            where: {
                or: [
                    { read_at:   { less_than: daysAgo(now, RETENTION.readNotificationDays) } },
                    { createdAt: { less_than: daysAgo(now, RETENTION.notificationDays) } },
                ],
            },
        })],
    ];

    for (const [label, run] of steps) {
        try {
            const result = await run();
            const count = Array.isArray(result?.docs) ? result.docs.length : 0;
            if (count) console.log(`[retention] ${label}: ${count}`);
        } catch (err) {
            console.warn(`[retention] ${label} failed:`, err?.message);
        }
    }
}
