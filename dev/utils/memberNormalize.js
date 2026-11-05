/**
 * Normalize a raw member object into the shape used by people-dialog.
 * Pure function — no DOM or LitElement dependency, safe to unit test.
 */
export function normalizeMember(m) {
    if (m.type === 'group') {
        return {
            id: String(m.id),
            type: 'group',
            name: m.displayName || m.name || '',
            memberCount: m.memberCount ?? null,
            groupMembers: Array.isArray(m.groupMembers) ? m.groupMembers : [],
            hiddenMemberCount: m.hiddenMemberCount || 0,
            role: m.role || 'collaborator',
            locked: Boolean(m.locked)
        };
    }
    return {
        id: String(m.id),
        type: 'user',
        email: m.email || '',
        username: m.username || '',
        firstName: m.firstName || m.first_name || '',
        lastName: m.lastName || m.last_name || '',
        avatarUrl: m.avatarUrl || null,
        role: m.locked ? 'admin' : (m.role || 'collaborator'),
        locked: Boolean(m.locked)
    };
}
