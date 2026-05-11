import db from '../db/database.js';

/**
 * File Model - handles file metadata in database
 */
class File {
    /**
     * Create a new file record
     */
    static create({ userId, projectId = null, originalName, storedName, filePath, fileSize, mimeType }) {
        const stmt = db.prepare(`
            INSERT INTO files (user_id, project_id, original_name, stored_name, file_path, file_size, mime_type, last_modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const result = stmt.run(userId, projectId, originalName, storedName, filePath, fileSize, mimeType);

        return {
            id: result.lastInsertRowid,
            userId,
            projectId,
            originalName,
            storedName,
            filePath,
            fileSize,
            mimeType,
            uploadDate: new Date().toISOString()
        };
    }

    /**
     * Find all files for a user
     */
    static findByUserId(userId) {
        const stmt = db.prepare(`
            SELECT * FROM files WHERE user_id = ?
            ORDER BY COALESCE(last_modified_at, upload_date) DESC, id DESC
        `);
        return stmt.all(userId);
    }

    /**
     * List files for a user with pagination, optional name search, and sort.
     * @returns {{ files: Array, total: number }}
     */
    static listForUser(userId, options = {}) {
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
        const offset = Math.max(Number(options.offset) || 0, 0);
        const search = (options.search || '').trim();
        const rawSort = options.sortBy;
        const sortBy = rawSort === 'name' ? 'name' : rawSort === 'viewed' ? 'viewed' : 'date';
        const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC';

        let orderSql;
        if (sortBy === 'name') {
            orderSql = `original_name ${sortDir} COLLATE NOCASE, id ${sortDir}`;
        } else if (sortBy === 'viewed') {
            // Most recent first; files never opened in the viewer sort last.
            orderSql = '(last_viewed_at IS NULL) ASC, last_viewed_at DESC, id DESC';
        } else {
            orderSql = `COALESCE(last_modified_at, upload_date) ${sortDir}, id ${sortDir}`;
        }

        if (!search) {
            const countStmt = db.prepare('SELECT COUNT(*) as total FROM files WHERE user_id = ?');
            const { total } = countStmt.get(userId);
            const listStmt = db.prepare(
                `SELECT * FROM files WHERE user_id = ? ORDER BY ${orderSql} LIMIT ? OFFSET ?`
            );
            const files = listStmt.all(userId, limit, offset);
            return { files, total: total ?? 0 };
        }

        const escapeForLike = (s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const pattern = `%${escapeForLike(search)}%`;
        const countStmt = db.prepare(
            "SELECT COUNT(*) as total FROM files WHERE user_id = ? AND original_name LIKE ? ESCAPE '\\'"
        );
        const { total } = countStmt.get(userId, pattern);
        const listStmt = db.prepare(
            `SELECT * FROM files WHERE user_id = ? AND original_name LIKE ? ESCAPE '\\' ORDER BY ${orderSql} LIMIT ? OFFSET ?`
        );
        const files = listStmt.all(userId, pattern, limit, offset);
        return { files, total: total ?? 0 };
    }

    /**
     * Find all files for a project
     */
    static findByProjectId(projectId) {
        const stmt = db.prepare(`
            SELECT * FROM files WHERE project_id = ?
            ORDER BY COALESCE(last_modified_at, upload_date) DESC, id DESC
        `);
        return stmt.all(projectId);
    }

    /**
     * Find a specific file by ID
     */
    static findById(fileId) {
        const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
        return stmt.get(fileId);
    }

    /**
     * Find a file by its stored name
     */
    static findByStoredName(storedName) {
        const stmt = db.prepare('SELECT * FROM files WHERE stored_name = ?');
        return stmt.get(storedName);
    }

    /**
     * Update an existing file record's metadata
     */
    static updateMetadata(fileId, { originalName, filePath, fileSize, mimeType }) {
        const stmt = db.prepare(`
            UPDATE files
            SET original_name = ?, file_path = ?, file_size = ?, mime_type = ?,
                last_modified_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        return stmt.run(originalName, filePath, fileSize, mimeType, fileId);
    }

    /**
     * Record that someone opened this file in the viewer (or follow-up activity).
     */
    static touchLastViewed(fileId) {
        const id = Number(fileId);
        if (!Number.isInteger(id) || id <= 0) return { changes: 0 };
        const stmt = db.prepare(`
            UPDATE files SET last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?
        `);
        return stmt.run(id);
    }

    /**
     * Delete a file record
     */
    static delete(fileId) {
        const stmt = db.prepare('DELETE FROM files WHERE id = ?');
        return stmt.run(fileId);
    }

    /**
     * Check if a user owns a file
     */
    static isOwner(fileId, userId) {
        const stmt = db.prepare('SELECT id FROM files WHERE id = ? AND user_id = ?');
        const result = stmt.get(fileId, userId);
        return result !== null;
    }

    /**
     * Get total storage used by a user (in bytes)
     */
    static getUserStorageUsed(userId) {
        const stmt = db.prepare('SELECT SUM(file_size) as total FROM files WHERE user_id = ?');
        const result = stmt.get(userId);
        return result?.total || 0;
    }
}

export default File;
