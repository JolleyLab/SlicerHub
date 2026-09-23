/**
 * Force / voluntary password change for Directus-backed product users.
 * Local-only users update bcrypt hash on the shadow password column.
 * Directus-linked users also set first_name / last_name (provisioned accounts
 * otherwise have no Studio access to edit profile).
 *
 * After a Directus password update, returns fresh Directus login tokens so the
 * BFF can replace the session's call-as-user material (old refresh is often
 * revoked when the password changes).
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

async function loginDirectusForTokens(email, password) {
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
        body: JSON.stringify({
            email: String(email || '').trim().toLowerCase(),
            password: String(password || ''),
            mode: 'json'
        })
    });

    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    if (!res.ok) {
        return null;
    }

    const data = body?.data || body;
    const accessToken = data?.access_token;
    if (!accessToken) return null;

    return {
        accessToken,
        refreshToken: data?.refresh_token || null,
        expires: data?.expires
    };
}

/**
 * @param {{ userId: number, currentPassword: string, newPassword: string, firstName?: string, lastName?: string }} input
 * @returns {Promise<object & { directusTokens?: { accessToken: string, refreshToken?: string|null, expires?: number } }>}
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

        const verified = await loginDirectusForTokens(user.email, current);
        if (!verified?.accessToken) {
            throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
        }

        await updateDirectusUser(link.external_id, {
            password: next,
            firstName: first,
            lastName: last
        });
        User.clearMustChangePassword(userId);

        // Password change typically invalidates the prior Directus session — mint new tokens.
        const directusTokens = await loginDirectusForTokens(user.email, next);
        if (!directusTokens?.accessToken) {
            throw new AppError(
                msg('directus.session_refresh_after_password_failed'),
                502,
                null,
                'directus.session_refresh_after_password_failed'
            );
        }

        const updated = User.findById(userId);
        return {
            ...updated,
            firstName: first,
            lastName: last,
            mustChangePassword: false,
            directusTokens
        };
    }

    // Local-account path (no Directus link): update SQLite password_hash
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!row?.password_hash || String(row.password_hash).startsWith('BRIDGED:')) {
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
