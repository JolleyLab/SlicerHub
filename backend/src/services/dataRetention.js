/**
 * Retention sweep for personal data in Payload that has served its purpose.
 *
 *   password-reset-tokens  — deleted 1 day after use or expiry
 *   case-invites           — rejected/expired ones deleted after 30 days
 *   registration-requests  — rejected ones deleted after 30 days; approved ones whose
 *                            link expired unused deleted 30 days after expiry;
 *                            completed ones lose affiliation/intended-use 30 days on
 *                            (reviewers' "recently decided" list only looks back 7 days)
 *
 * Runs at startup and every few hours (server.js). Each step is independent so one
 * failure doesn't stop the rest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION = Object.freeze({
    resetTokenDays: 1,
    closedInviteDays: 30,
    registrationDays: 30,
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
        ['expired/used password reset tokens', () => payload.delete({
            collection: 'password-reset-tokens',
            where: {
                or: [
                    { used_at:    { less_than: daysAgo(now, RETENTION.resetTokenDays) } },
                    { expires_at: { less_than: daysAgo(now, RETENTION.resetTokenDays) } },
                ],
            },
        })],
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
        ['unused approved registration requests', () => payload.delete({
            collection: 'registration-requests',
            where: {
                and: [
                    { status: { equals: 'approved' } },
                    { completion_token_expires_at: { less_than: daysAgo(now, RETENTION.registrationDays) } },
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
