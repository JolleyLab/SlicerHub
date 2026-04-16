import db from '../db/database.js';

/**
 * File Model - handles file metadata in database
 */
class File {
    /**
     * Create a new file record
     */
    static create({ userId, originalName, storedName, filePath, fileSize, mimeType, parentFileId = null }) {
        const stmt = db.prepare(`
            INSERT INTO files (user_id, original_name, stored_name, file_path, file_size, mime_type, parent_file_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(userId, originalName, storedName, filePath, fileSize, mimeType, parentFileId);

        return {
            id: result.lastInsertRowid,
            userId,
            originalName,
            storedName,
            filePath,
            fileSize,
            mimeType,
            parentFileId,
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
     * Update file size and path (used when overwriting a saved scene)
     */
    static update(fileId, { fileSize, filePath }) {
        const stmt = db.prepare(`
            UPDATE files SET file_size = ?, file_path = ?, upload_date = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(fileSize, filePath, fileId);
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
