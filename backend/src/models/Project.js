import db from '../db/database.js';

const ROLE_ENUM = {
    admin: 0,
    collaborator: 1,
    observer: 2
};

const ROLE_BY_VALUE = {
    0: 'admin',
    1: 'collaborator',
    2: 'observer'
};

class Project {
    static create({ name, creatorUserId }) {
        const stmt = db.prepare(`
            INSERT INTO projects (name, creator_user_id)
            VALUES (?, ?)
        `);
        const result = stmt.run(name, creatorUserId);

        if (result.lastInsertRowid) {
            return { id: result.lastInsertRowid, name, creatorUserId };
        }

        // Fallback for sql.js environments where last_insert_rowid can be unreliable.
        const fallback = db.prepare(`
            SELECT id
            FROM projects
            WHERE name = ? AND creator_user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `).get(name, creatorUserId);

        if (!fallback?.id) {
            throw new Error('Failed to determine inserted project id');
        }

        return { id: fallback.id, name, creatorUserId };
    }

    static addCollaborator({ projectId, userId, role }) {
        const roleValue = typeof role === 'number' ? role : ROLE_ENUM[role];
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO collaborators (project_id, user_id, role)
            VALUES (?, ?, ?)
        `);
        stmt.run(projectId, userId, roleValue);
    }

    static listForUser({ userId, limit = 20, offset = 0 }) {
        const stmt = db.prepare(`
            SELECT
                p.id,
                p.name,
                p.creator_user_id,
                p.created_at,
                c.role
            FROM projects p
            INNER JOIN collaborators c ON c.project_id = p.id
            WHERE c.user_id = ?
            ORDER BY p.created_at DESC, p.id DESC
            LIMIT ? OFFSET ?
        `);

        const rows = stmt.all(userId, limit, offset);
        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            role: ROLE_BY_VALUE[row.role] || 'observer',
            isCreator: row.creator_user_id === userId,
            createdAt: row.created_at
        }));
    }

    static countForUser(userId) {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count
            FROM projects p
            INNER JOIN collaborators c ON c.project_id = p.id
            WHERE c.user_id = ?
        `);
        const row = stmt.get(userId);
        return row?.count || 0;
    }

    static findForUser({ projectId, userId }) {
        const stmt = db.prepare(`
            SELECT
                p.id,
                p.name,
                p.creator_user_id,
                p.created_at,
                c.role AS user_role
            FROM projects p
            INNER JOIN collaborators c ON c.project_id = p.id
            WHERE p.id = ? AND c.user_id = ?
            LIMIT 1
        `);
        const row = stmt.get(projectId, userId);
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            creatorUserId: row.creator_user_id,
            createdAt: row.created_at,
            userRole: ROLE_BY_VALUE[row.user_role] || 'observer',
            isCreator: row.creator_user_id === userId
        };
    }

    static listCollaborators(projectId) {
        const stmt = db.prepare(`
            SELECT
                c.user_id,
                c.role,
                u.username,
                u.email
            FROM collaborators c
            INNER JOIN users u ON u.id = c.user_id
            WHERE c.project_id = ?
            ORDER BY c.role ASC, u.username COLLATE NOCASE ASC
        `);
        const rows = stmt.all(projectId);
        return rows.map((row) => ({
            user: {
                id: row.user_id,
                username: row.username,
                email: row.email
            },
            role: ROLE_BY_VALUE[row.role] || 'observer'
        }));
    }

    static replaceCollaborators({ projectId, collaborators }) {
        db.prepare('DELETE FROM collaborators WHERE project_id = ?').run(projectId);
        for (const collaborator of collaborators) {
            this.addCollaborator({
                projectId,
                userId: collaborator.userId,
                role: collaborator.role
            });
        }
    }
}

export default Project;
export { ROLE_ENUM };
