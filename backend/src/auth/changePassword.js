/**
 * Force / voluntary password change for Directus-backed product users.
 * Local-only users update bcrypt hash on the shadow password column.
 */

import config from '../config/index.js';
import User from '../models/User.js';
import { findDirectusLinkForUser } from './identityStore.js';
import {
    isDirectusConfigured,
    updateDirectusUserPassword
} from '../services/directus.js';
import { ValidationError, UnauthorizedError, AppError } from '../utils/errors.js';
import bcrypt from 'bcrypt';
import db from '../db/database.js';

const minLen = () => config.security?.passwordMinLength || 8;

async function verifyDirectusPassword(email, password) {
    const base = (config.directus.url || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new AppError('Directus is not configured', 503);
    }

    const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        body: JSON.stringify({ email, password })
    });

    if (res.ok) return true;
    return false;
}

/**
 * @param {{ userId: number, currentPassword: string, newPassword: string }} input
 */
export async function changePasswordForUser({ userId, currentPassword, newPassword }) {
    const user = User.findById(userId);
    if (!user) {
        throw new ValidationError('User not found');
    }

    const next = String(newPassword || '');
    const current = String(currentPassword || '');
    if (next.length < minLen()) {
        throw new ValidationError(`New password must be at least ${minLen()} characters`);
    }
    if (!current) {
        throw new ValidationError('Current password is required');
    }
    if (next === current) {
        throw new ValidationError('New password must differ from current password');
    }

    const link = findDirectusLinkForUser(userId);

    if (link && isDirectusConfigured()) {
        const ok = await verifyDirectusPassword(user.email, current);
        if (!ok) {
            throw new UnauthorizedError('Current password is incorrect');
        }
        await updateDirectusUserPassword(link.external_id, next);
        User.clearMustChangePassword(userId);
        return User.findById(userId);
    }

    // Local-account path (no Directus link): update SQLite password_hash
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!row?.password_hash) {
        throw new AppError('Cannot change password for this account', 400);
    }
    const valid = await bcrypt.compare(current, row.password_hash);
    if (!valid) {
        throw new UnauthorizedError('Current password is incorrect');
    }

    const hash = await bcrypt.hash(next, config.security.bcryptRounds);
    db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(hash, userId);

    return User.findById(userId);
}
