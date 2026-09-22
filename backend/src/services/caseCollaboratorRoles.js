/**
 * App-managed case collaborator roles (product runtime).
 * Directus junction holds membership; when Directus `role` writes fail
 * (e.g. INTERNAL_SERVER_ERROR on the dropdown), we keep the intended role here.
 */

import db from '../db/database.js';

export function listCaseCollaboratorRoleOverrides(caseId) {
    const caseKey = String(caseId || '').trim();
    if (!caseKey) return [];
    return db.prepare(`
        SELECT case_id, directus_user_id, role, updated_at
        FROM case_collaborator_roles
        WHERE case_id = ?
    `).all(caseKey);
}

export function getCaseCollaboratorRoleOverride(caseId, directusUserId) {
    const caseKey = String(caseId || '').trim();
    const userId = String(directusUserId || '').trim();
    if (!caseKey || !userId) return null;
    const row = db.prepare(`
        SELECT role FROM case_collaborator_roles
        WHERE case_id = ? AND directus_user_id = ?
        LIMIT 1
    `).get(caseKey, userId);
    return row?.role ? String(row.role) : null;
}

export function setCaseCollaboratorRoleOverride(caseId, directusUserId, role) {
    const caseKey = String(caseId || '').trim();
    const userId = String(directusUserId || '').trim();
    const nextRole = String(role || 'collaborator').trim().toLowerCase();
    if (!caseKey || !userId) return null;
    db.prepare(`
        INSERT INTO case_collaborator_roles (case_id, directus_user_id, role, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(case_id, directus_user_id) DO UPDATE SET
            role = excluded.role,
            updated_at = CURRENT_TIMESTAMP
    `).run(caseKey, userId, nextRole);
    return getCaseCollaboratorRoleOverride(caseKey, userId);
}

export function deleteCaseCollaboratorRoleOverride(caseId, directusUserId) {
    const caseKey = String(caseId || '').trim();
    const userId = String(directusUserId || '').trim();
    if (!caseKey || !userId) return;
    db.prepare(`
        DELETE FROM case_collaborator_roles
        WHERE case_id = ? AND directus_user_id = ?
    `).run(caseKey, userId);
}

/** Overlay SQLite roles onto collaborator list rows (mutates/returns new list). */
export function applyCaseCollaboratorRoleOverrides(caseId, collaborators) {
    const list = Array.isArray(collaborators) ? collaborators : [];
    const overrides = listCaseCollaboratorRoleOverrides(caseId);
    if (!overrides.length) return list;
    const byUser = new Map(
        overrides.map((row) => [String(row.directus_user_id), String(row.role)])
    );
    return list.map((member) => {
        const key = member?.id != null ? String(member.id) : '';
        if (!key || !byUser.has(key)) return member;
        return { ...member, role: byUser.get(key) };
    });
}
