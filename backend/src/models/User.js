import bcrypt from 'bcrypt';
import db from '../db/database.js';
import config from '../config/index.js';
import { ConflictError } from '../utils/errors.js';

const SALT_ROUNDS = config.security.bcryptRounds;

class User {
    /**
     * Create a new user
     */
    static async create({ username, email, password }) {
        // Validate input
        if (!username || !email || !password) {
            throw new Error('Username, email, and password are required');
        }

        // Check if user already exists
        const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
            .get(username, email);

        if (existing) {
            throw new ConflictError('Username or email already exists');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert user
        const result = db.prepare(`
            INSERT INTO users (username, email, password_hash)
            VALUES (?, ?, ?)
        `).run(username, email, passwordHash);

        console.log('Insert result:', result);
        console.log('lastInsertRowid:', result.lastInsertRowid);

        // If lastInsertRowid is null, try to find by username
        if (!result.lastInsertRowid) {
            const user = this.findByUsername(username);
            if (user) return user;
            throw new Error('Failed to create user');
        }

        return this.findById(result.lastInsertRowid);
    }

    /**
     * Find user by ID
     */
    static findById(id) {
        const user = db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role
            FROM users WHERE id = ?
        `).get(id);

        return user || null;
    }

    /**
     * Find user by username
     */
    static findByUsername(username) {
        const user = db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role
            FROM users WHERE username = ?
        `).get(username);

        return user || null;
    }

    /**
     * Find user by email
     */
    static findByEmail(email) {
        const user = db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role
            FROM users WHERE email = ?
        `).get(email);

        return user || null;
    }

    /**
     * Verify password for a user
     */
    static async verifyPassword(username, password) {
        const user = db.prepare(`
            SELECT id, username, email, password_hash, is_active, role
            FROM users WHERE username = ?
        `).get(username);

        if (!user) {
            return null;
        }

        if (!user.is_active) {
            throw new Error('Account is disabled');
        }

        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return null;
        }

        // Update last login
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
            .run(user.id);

        // Return user without password hash
        const { password_hash, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    /**
     * Update user
     */
    static update(id, data) {
        const allowedFields = ['email', 'is_active', 'role'];
        const updates = [];
        const values = [];

        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (updates.length === 0) {
            throw new Error('No valid fields to update');
        }

        values.push(id);

        db.prepare(`
            UPDATE users 
            SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(...values);

        return this.findById(id);
    }

    /**
     * Change password
     */
    static async changePassword(id, newPassword) {
        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        db.prepare(`
            UPDATE users 
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(passwordHash, id);

        return true;
    }

    /**
     * Delete user
     */
    static delete(id) {
        const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /**
     * Get all users (admin function)
     */
    static getAll() {
        return db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role
            FROM users
            ORDER BY created_at DESC
        `).all();
    }
}

export default User;
