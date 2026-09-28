/**
 * Shared normalizers: convert server events/notifications into the activity card shape
 * { id, category, title, detail?, at, caseId?, caseTitle? } used by home-page and notification-bell.
 */

import { t } from '../i18n/index.js';

const ROLE_LABEL_KEYS = {
    admin: 'roles.admin',
    collaborator: 'roles.collaborator',
    observer: 'roles.observer',
    read_only: 'roles.readOnly'
};

function roleLabel(role) {
    const key = ROLE_LABEL_KEYS[role];
    return key ? t(key) : String(role || '');
}

/** Invite event from /api/directus/activity/recent → activity card shape. */
export function eventToActivity(event) {
    const sent = event.type === 'invite_sent';
    return {
        id: event.id,
        category: 'collaboration',
        title: t(sent ? 'home.activity.inviteSentTitle' : 'home.activity.inviteApprovedTitle', {
            actor: event.actorIsMe ? t('home.activity.you') : (event.actorName || t('home.activity.someone')),
            invitee: event.inviteeName || event.inviteeEmail,
            case: event.caseTitle || t('home.invite.untitledCase')
        }),
        detail: t('home.card.asRole', { role: roleLabel(event.proposedRole) }),
        at: event.at,
        caseId: event.caseId,
        caseTitle: event.caseTitle,
        inviteId: event.inviteId
    };
}

/** Mention notification from /api/notifications → activity card shape. */
export function mentionToActivity(notification) {
    return {
        id: `notif:${notification.id}`,
        category: 'mention',
        title: notification.title || t('home.activity.mentionTitle'),
        detail: notification.body || null,
        at: notification.created_at,
        caseId: notification.case_id || notification.caseId || null,
        caseTitle: notification.caseTitle || null
    };
}
