/**
 * Normalize a raw member object into the shape used by people-dialog.
 * Pure function — no DOM or LitElement dependency, safe to unit test.
 */
export function normalizeMember(m) {
    return {
        id: String(m.id),
        email: m.email || '',
        username: m.username || '',
        firstName: m.firstName || m.first_name || '',
        lastName: m.lastName || m.last_name || '',
        avatarUrl: m.avatarUrl || null,
        role: m.locked ? 'admin' : (m.role || 'collaborator'),
        locked: Boolean(m.locked)
    };
}
