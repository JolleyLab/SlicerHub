import { t } from '../i18n/index.js';

/**
 * Hover text listing the group members the viewer may see; the rest
 * (names hidden by the server) are only counted.
 */
export function groupMembersTitle(members, hiddenCount = 0) {
    const named = (Array.isArray(members) ? members : [])
        .map((m) => (m.email ? `${m.displayName} (${m.email})` : m.displayName));
    if (!named.length) {
        return hiddenCount > 0 ? t('people.groupMembersHidden', { n: hiddenCount }) : t('people.noGroupMembers');
    }
    const names = named.join(', ');
    return hiddenCount > 0
        ? t('people.groupMembersTitleMore', { names, n: hiddenCount })
        : t('people.groupMembersTitle', { names });
}
