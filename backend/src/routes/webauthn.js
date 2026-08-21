/**
 * WebAuthn / passkey routes. Protocol helpers live in @simplewebauthn/server.
 */

import User from '../models/User.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { ValidationError, UnauthorizedError, NotFoundError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { recordAuthEvent } from '../auth/auditLog.js';
import { issueAppSession } from '../auth/session.js';
import {
    isWebAuthnEnabled,
    registrationOptionsForUser,
    verifyRegistrationForUser,
    authenticationOptions,
    verifyAuthentication,
    listUserPasskeys,
    removeUserPasskey
} from '../auth/webauthn/service.js';

const webauthnRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: 'Too many passkey attempts. Please wait and try again.',
    getKey: (req) => `webauthn:ip:${getRateLimitClientIp(req)}`
});

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
        preferences: user.preferences
    };
}

export default function webauthnRoutes(app) {
    app.get('/api/auth/webauthn/status', asyncHandler(async (_req, res) => {
        res.json({ enabled: isWebAuthnEnabled() });
    }));

    /** Begin registration (must already be signed in). */
    app.post(
        '/api/auth/webauthn/register/options',
        requireAllowedWebOrigin,
        authenticateToken,
        webauthnRateLimit,
        asyncHandler(async (req, res) => {
            const user = User.findById(req.user.id);
            if (!user) throw new NotFoundError('User not found');
            const options = await registrationOptionsForUser(user);
            res.json(options);
        })
    );

    app.post(
        '/api/auth/webauthn/register/verify',
        requireAllowedWebOrigin,
        authenticateToken,
        webauthnRateLimit,
        asyncHandler(async (req, res) => {
            const user = User.findById(req.user.id);
            if (!user) throw new NotFoundError('User not found');
            const credential = await verifyRegistrationForUser(
                user,
                req.body,
                req.body?.friendlyName || null
            );
            recordAuthEvent({
                event: 'webauthn_register',
                provider: 'webauthn',
                userId: user.id,
                identity: user.email || user.username,
                req
            });
            res.status(201).json({ message: 'Passkey registered', credential });
        })
    );

    /** List passkeys for current user. */
    app.get(
        '/api/auth/webauthn/credentials',
        authenticateToken,
        asyncHandler(async (req, res) => {
            res.json({ credentials: listUserPasskeys(req.user.id) });
        })
    );

    app.delete(
        '/api/auth/webauthn/credentials/:id',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const id = parseInt(req.params.id, 10);
            if (!Number.isFinite(id)) throw new ValidationError('Invalid credential id');
            const ok = removeUserPasskey(req.user.id, id);
            if (!ok) throw new NotFoundError('Passkey not found');
            recordAuthEvent({
                event: 'webauthn_revoke',
                provider: 'webauthn',
                userId: req.user.id,
                detail: String(id),
                req
            });
            res.json({ message: 'Passkey removed' });
        })
    );

    /** Begin login ceremony (public). */
    app.post(
        '/api/auth/webauthn/login/options',
        requireAllowedWebOrigin,
        webauthnRateLimit,
        asyncHandler(async (req, res) => {
            const options = await authenticationOptions({
                identityHint: req.body?.identity || req.body?.username || req.body?.email
            });
            res.json(options);
        })
    );

    /** Complete login ceremony → product session. */
    app.post(
        '/api/auth/webauthn/login/verify',
        requireAllowedWebOrigin,
        webauthnRateLimit,
        asyncHandler(async (req, res) => {
            let result;
            try {
                result = await verifyAuthentication(req.body);
            } catch (err) {
                recordAuthEvent({
                    event: 'login_failure',
                    provider: 'webauthn',
                    detail: err.code || 'webauthn_error',
                    req
                });
                throw err;
            }

            if (!result?.user) {
                recordAuthEvent({
                    event: 'login_failure',
                    provider: 'webauthn',
                    detail: 'invalid_credentials',
                    req
                });
                throw new UnauthorizedError('Invalid credentials');
            }

            const { user: sessionUser } = issueAppSession(req, res, result.user);
            recordAuthEvent({
                event: 'login_success',
                provider: 'webauthn',
                userId: result.user.id,
                identity: result.user.email || result.user.username,
                req
            });

            res.json({
                message: 'Login successful',
                user: publicUser(sessionUser),
                provider: 'webauthn'
            });
        })
    );
}
