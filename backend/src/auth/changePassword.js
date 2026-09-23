/**
 * Force / voluntary password change for Directus-backed product users.
 * Local-only users update bcrypt hash on the shadow password column.
 * Directus-linked users also set first_name / last_name (provisioned accounts
 * otherwise have no Studio access to edit profile).
 */

import config from '../config/index.js';
import User from '../models/User.js';
import { findDirectusLinkForUser } from './identityStore.js';
import {
    isDirectusConfigured,
    updateDirectusUser
} from '../services/directus.js';
import { ValidationError, UnauthorizedError, AppError } from '../utils/errors.js';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { msg } from '../i18n/index.js';

const minLen = () => config.security?.passwordMinLength || 8;

async function verifyDirectusPassword(email, password) {
    const base = (config.directus.url || '').trim().replace(/\/+$/, '');
    if (!base) {
        throw new AppError(msg('directus.not_configured'), 503, null, 'directus.not_configured');
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
 * @param {{ userId: number, currentPassword: string, newPassword: string, firstName?: string, lastName?: string }} input
 */
export async function changePasswordForUser({
    userId,
    currentPassword,
    newPassword,
    firstName,
    lastName
}) {
    const user = User.findById(userId);
    if (!user) {
        throw new ValidationError(msg('user.not_found'), null, 'user.not_found');
    }

    const next = String(newPassword || '');
    const current = String(currentPassword || '');
    if (next.length < minLen()) {
        throw new ValidationError(msg('auth.password_min_length_short', { min: minLen() }), null, 'auth.password_min_length_short');
    }
    if (!current) {
        throw new ValidationError(msg('auth.current_password_required'), null, 'auth.current_password_required');
    }
    if (next === current) {
        throw new ValidationError(msg('auth.password_must_differ'), null, 'auth.password_must_differ');
    }

    const link = findDirectusLinkForUser(userId);

    if (link && isDirectusConfigured()) {
        const first = String(firstName || '').trim();
        const last = String(lastName || '').trim();
        if (!first) {
            throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
        }
        if (!last) {
            throw new ValidationError(msg('auth.last_name_required'), null, 'auth.last_name_required');
        }

        const ok = await verifyDirectusPassword(user.email, current);
        if (!ok) {
            throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
        }
        await updateDirectusUser(link.external_id, {
            password: next,
            firstName: first,
            lastName: last
        });
        User.clearMustChangePassword(userId);
        const updated = User.findById(userId);
        return {
            ...updated,
            firstName: first,
            lastName: last,
            mustChangePassword: false
        };
    }

    // Local-account path (no Directus link): update SQLite password_hash
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!row?.password_hash) {
        throw new AppError(msg('auth.password_change_not_allowed'), 400, null, 'auth.password_change_not_allowed');
    }
    const valid = await bcrypt.compare(current, row.password_hash);
    if (!valid) {
        throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
    }

    const hash = await bcrypt.hash(next, config.security.bcryptRounds);
    db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(hash, userId);

    return User.findById(userId);
}
