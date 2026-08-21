import bcrypt from 'bcrypt';
import db, { flushDatabase } from '../db/database.js';
import config from '../config/index.js';
import { ConflictError } from '../utils/errors.js';
import {
    mergeUserPreferences,
    parseUserPreferencesJson
} from '../gpu/userPreferences.js';

const SALT_ROUNDS = config.security.bcryptRounds;

/** Used only to equalize timing when identity is unknown (never a real password). */
const TIMING_PAD_HASH = bcrypt.hashSync(
    '__auth_timing_pad_not_a_password__',
    Math.min(SALT_ROUNDS, 10)
);

function mapUserRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        email: row.email,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_login: row.last_login,
        is_active: row.is_active,
        role: row.role,
        mustChangePassword: Boolean(row.must_change_password),
        preferences: parseUserPreferencesJson(row.preferences_json)
    };
}

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
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role,
                   must_change_password, preferences_json
            FROM users WHERE id = ?
        `).get(id);

        return mapUserRow(user);
    }

    /**
     * Find user by username
     */
    static findByUsername(username) {
        const user = db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role,
                   must_change_password, preferences_json
            FROM users WHERE username = ?
        `).get(username);

        return mapUserRow(user);
    }

    /**
     * Find user by email
     */
    static findByEmail(email) {
        const normalized = String(email || '').trim();
        const user = db.prepare(`
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role,
                   must_change_password, preferences_json
            FROM users WHERE lower(email) = lower(?)
        `).get(normalized);

        return mapUserRow(user);
    }

    /**
     * Verify password for a user (username or email identity).
     * Unknown identities still run a bcrypt compare to reduce timing enumeration.
     * Disabled accounts fail the same way as bad credentials (no status leak).
     */
    static async verifyPassword(identity, password) {
        const key = String(identity || '').trim();
        if (!key) return null;

        const user = db.prepare(`
            SELECT id, username, email, password_hash, is_active, role,
                   must_change_password, preferences_json
            FROM users
            WHERE username = ? OR lower(email) = lower(?)
        `).get(key, key);

        if (!user || !user.is_active) {
            await bcrypt.compare(String(password || ''), TIMING_PAD_HASH);
            return null;
        }

        // External/shadow accounts use a random unusable hash; still require compare
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return null;
        }

        this.touchLastLogin(user.id);

        const { password_hash, preferences_json, must_change_password, ...rest } = user;
        return {
            ...rest,
            mustChangePassword: Boolean(must_change_password),
            preferences: parseUserPreferencesJson(preferences_json)
        };
    }

    /** When true, SPA should force password change before normal app use. */
    static setMustChangePassword(userId, value = true) {
        db.prepare('UPDATE users SET must_change_password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(value ? 1 : 0, userId);
        try {
            flushDatabase();
        } catch {
            /* best effort */
        }
        return this.findById(userId);
    }

    static clearMustChangePassword(userId) {
        return this.setMustChangePassword(userId, false);
    }

    static touchLastLogin(userId) {
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
            .run(userId);
    }

    /**
     * Local user row for an external IdP identity (no usable password).
     * Username collision: append short suffix.
     */
    static async createExternalShadow({ email, username }) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail) {
            throw new Error('Email is required for external user');
        }

        const existing = this.findByEmail(normalizedEmail);
        if (existing) return existing;

        let base = String(username || normalizedEmail.split('@')[0] || 'user')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 40) || 'user';
        let candidate = base;
        let n = 0;
        while (this.findByUsername(candidate)) {
            n += 1;
            candidate = `${base.slice(0, 32)}_${n}`;
        }

        // Unusable credential: random hash; must never equal user-chosen passwords
        const randomSecret = await bcrypt.hash(
            `ext:${normalizedEmail}:${Date.now()}:${Math.random()}`,
            SALT_ROUNDS
        );

        const result = db.prepare(`
            INSERT INTO users (username, email, password_hash, role)
            VALUES (?, ?, ?, 'user')
        `).run(candidate, normalizedEmail, randomSecret);

        const id = result.lastInsertRowid
            || this.findByUsername(candidate)?.id;
        if (!id) throw new Error('Failed to create external user');

        this.touchLastLogin(id);
        return this.findById(id);
    }

    static getPreferences(userId) {
        const row = db.prepare('SELECT preferences_json FROM users WHERE id = ?').get(userId);
        if (!row) return null;
        return parseUserPreferencesJson(row.preferences_json);
    }

    static updatePreferences(userId, patch = {}) {
        const current = this.getPreferences(userId);
        if (!current) {
            return null;
        }
        const next = mergeUserPreferences(current, patch);
        db.prepare(`
            UPDATE users
            SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(JSON.stringify(next), userId);
        return next;
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
            SELECT id, username, email, created_at, updated_at, last_login, is_active, role,
                   must_change_password, preferences_json
            FROM users
            ORDER BY created_at DESC
        `).all().map(mapUserRow);
    }
}

export default User;
