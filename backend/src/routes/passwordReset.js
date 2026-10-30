/**
 * Password reset / account activation flow.
 *
 * Works for two cases via a single `kind` field:
 *   'activation' — migrated or KC-provisioned user who has never set a password
 *   'reset'      — existing active user who forgot their password
 *
 * Public:
 *   POST /api/auth/password-reset/request   — send a reset/activation email
 *   GET  /api/auth/password-reset/preview   — validate token, return { email, kind, firstName }
 *   POST /api/auth/password-reset/complete  — set new password, enable account, log in
 */

import crypto from 'crypto';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import { getPayloadClient } from '../payload/index.js';
import { findUserByEmail, setKeycloakUserPassword, enableKeycloakUser } from '../services/keycloakAdmin.js';
import { loginWithProvider } from '../auth/index.js';
import { sendPasswordResetEmail, sendAccountActivationEmail, isMailConfigured } from '../services/mail.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import config from '../config/index.js';

const COLLECTION = 'password-reset-tokens';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function mintToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken(raw) {
    return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

const requestRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: msg('passwordReset.rateLimited'),
    getKey: (req) => `pw-reset:${getRateLimitClientIp(req)}`
});

export default function passwordResetRoutes(app) {

    // POST /api/auth/password-reset/request
    // Accepts { email }. Never reveals whether the email exists (prevents enumeration).
    app.post('/api/auth/password-reset/request',
        requestRateLimit,
        asyncHandler(async (req, res) => {
            const email = String(req.body?.email || '').trim().toLowerCase();
            if (!email || !email.includes('@')) {
                throw new ValidationError(msg('auth.email_required'), null, 'auth.email_required');
            }

            const kcUser = await findUserByEmail(email).catch(() => null);

            // Always return 200 — don't reveal whether the email is registered
            if (!kcUser) {
                return res.json({ status: 'sent' });
            }

            const payload = getPayloadClient();
            if (!payload) return res.json({ status: 'sent' });

            const kind = kcUser.enabled === false ? 'activation' : 'reset';
            const rawToken  = mintToken();
            const tokenHash = hashToken(rawToken);
            const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

            // Invalidate any existing unused tokens for this email+kind
            const existing = await payload.find({
                collection: COLLECTION,
                where: { and: [{ email: { equals: email } }, { kind: { equals: kind } }, { used_at: { exists: false } }] },
                limit: 50,
                depth: 0,
            });
            for (const doc of existing.docs) {
                await payload.delete({ collection: COLLECTION, id: doc.id }).catch(() => {});
            }

            await payload.create({
                collection: COLLECTION,
                data: { email, token_hash: tokenHash, kind, expires_at: expiresAt },
            });

            const base = (config.publicAppUrl || 'http://localhost:8000').replace(/\/+$/, '');
            const resetUrl = `${base}/?reset=${encodeURIComponent(rawToken)}`;

            const firstName = kcUser.firstName || '';

            if (kind === 'activation') {
                await sendAccountActivationEmail({ to: email, firstName, activationUrl: resetUrl, expiresAt });
            } else {
                await sendPasswordResetEmail({ to: email, firstName, resetUrl, expiresAt });
            }

            const emailWorking = isMailConfigured();
            res.json({
                status: 'sent',
                // In dev (no SMTP), surface the link so it can be used directly
                ...(emailWorking ? {} : { resetUrl, kind })
            });
        })
    );

    // GET /api/auth/password-reset/preview?token=<raw>
    app.get('/api/auth/password-reset/preview',
        asyncHandler(async (req, res) => {
            const raw = String(req.query.token || '').trim();
            if (!raw) throw new ValidationError(msg('passwordReset.tokenRequired'), null, 'passwordReset.tokenRequired');

            const doc = await _findValidToken(raw);

            const kcUser = await findUserByEmail(doc.email).catch(() => null);
            res.json({
                email:     doc.email,
                kind:      doc.kind,
                firstName: kcUser?.firstName || '',
            });
        })
    );

    // POST /api/auth/password-reset/complete
    app.post('/api/auth/password-reset/complete',
        asyncHandler(async (req, res) => {
            const { token: rawToken, password } = req.body || {};

            const raw = String(rawToken || '').trim();
            if (!raw) throw new ValidationError(msg('passwordReset.tokenRequired'), null, 'passwordReset.tokenRequired');
            if (!password || String(password).length < 8) {
                throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
            }

            const doc = await _findValidToken(raw);

            const kcUser = await findUserByEmail(doc.email);
            if (!kcUser) throw new NotFoundError(msg('passwordReset.userNotFound'), null, 'passwordReset.userNotFound');

            await setKeycloakUserPassword(kcUser.id, String(password));

            if (doc.kind === 'activation') {
                await enableKeycloakUser(kcUser.id);
            }

            const payload = getPayloadClient();
            if (payload) {
                await payload.update({
                    collection: COLLECTION,
                    id: doc.id,
                    data: { used_at: new Date().toISOString() },
                }).catch(() => {});
            }

            const result = await loginWithProvider(req, res, {
                identity: doc.email,
                password: String(password)
            });

            if (!result) {
                return res.json({ status: 'completed' });
            }
            res.json({ status: 'completed', user: result.user });
        })
    );
}

async function _findValidToken(raw) {
    const payload = getPayloadClient();
    if (!payload) throw new ValidationError(msg('passwordReset.tokenInvalid'), null, 'passwordReset.tokenInvalid');

    const tokenHash = hashToken(raw);
    const result = await payload.find({
        collection: COLLECTION,
        where: { token_hash: { equals: tokenHash } },
        limit: 1,
        depth: 0,
    });
    const doc = result?.docs?.[0];
    if (!doc) throw new NotFoundError(msg('passwordReset.tokenInvalid'), null, 'passwordReset.tokenInvalid');
    if (doc.used_at) throw new ValidationError(msg('passwordReset.tokenAlreadyUsed'), null, 'passwordReset.tokenAlreadyUsed');
    if (new Date(doc.expires_at).getTime() < Date.now()) {
        throw new ValidationError(msg('passwordReset.tokenExpired'), null, 'passwordReset.tokenExpired');
    }
    return doc;
}
