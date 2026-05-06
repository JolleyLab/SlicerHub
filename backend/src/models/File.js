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
            INSERT INTO files (user_id, project_id, original_name, stored_name, file_path, file_size, mime_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
        const stmt = db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY upload_date DESC');
        return stmt.all(userId);
    }

    /**
     * Find all files for a project
     */
    static findByProjectId(projectId) {
        const stmt = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY upload_date DESC, id DESC');
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
            SET original_name = ?, file_path = ?, file_size = ?, mime_type = ?, upload_date = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        return stmt.run(originalName, filePath, fileSize, mimeType, fileId);
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
