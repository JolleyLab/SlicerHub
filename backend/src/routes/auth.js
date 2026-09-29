import User from '../models/User.js';
import {
    authenticateToken
} from '../middleware/authMiddleware.js';
import {
    ValidationError,
    UnauthorizedError,
    NotFoundError,
    ForbiddenError,
    AppError
} from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import {
    getPublicAuthConfig,
    getAuthProviderName,
    loginWithProvider,
    logoutCurrentSession,
    logoutAllSessions
} from '../auth/index.js';
import { issueAppSession, rotateAppSession } from '../auth/session.js';
import {
    findDirectusLinkForUser,
    getProviderTokens,
    storeProviderTokens,
    clearProviderTokens
} from '../auth/identityStore.js';
import { buildIdentityPayload } from '../auth/identityPayload.js';
import {
    attachStoredDirectusTokensToSession,
    getDirectusAccessTokenForAppUser
} from '../auth/directusUserSession.js';
import { setDirectusLinkCookie } from '../auth/directusLinkCookie.js';
import {
    loginRateLimitMiddleware,
    recordLoginFailure,
    recordLoginSuccess,
    throwIfAccountCooldown
} from '../auth/loginRateLimit.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { recordAuthEvent } from '../auth/auditLog.js';
import { changePasswordForUser } from '../auth/changePassword.js';
import config from '../config/index.js';
import { msg } from '../i18n/index.js';

const registerPerIpRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: msg('auth.register_rate_limit'),
    getKey: (req) => `register:ip:${getRateLimitClientIp(req)}`
});

function noteLoginFailure(req, res, { provider, identity, detail }) {
    const outcome = recordLoginFailure(req);
    recordAuthEvent({
        event: 'login_failure',
        provider,
        identity,
        detail,
        req
    });
    if (outcome.justLocked) {
        recordAuthEvent({
            event: 'login_lockout',
            provider,
            identity,
            detail: `cooldown_${outcome.retryAfterSec || 0}s`,
            req
        });
    }
    throwIfAccountCooldown(req, res, outcome);
}

function isAuthFailure(err) {
    if (!err) return false;
    if (err.code === 'OTP_REQUIRED') return false; // not a failed password attempt
    if (err instanceof UnauthorizedError) return true;
    if (err.statusCode === 401) return true;
    return false;
}

function loginIdentity(req) {
    return String(req.body?.identity || req.body?.username || req.body?.email || '').trim();
}

function publicUser(user) {
    const firstName = String(user?.firstName || user?.first_name || '').trim() || null;
    const lastName = String(user?.lastName || user?.last_name || '').trim() || null;
    const email = String(user?.email || '').trim() || null;
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
        id: user.id,
        username: user.username,
        email,
        firstName,
        lastName,
        displayName: fullName || email || String(user?.username || '').trim() || 'Guest',
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
        preferences: user.preferences
    };
}

export default function authRoutes(app) {
    /**
     * Public auth UI flags (provider, registration, identity labels).
     */
    app.get('/api/auth/config', asyncHandler(async (_req, res) => {
        res.json(getPublicAuthConfig());
    }));

    /**
     * Register new user (local accounts only)
     */
    app.post(
        '/api/auth/register',
        requireAllowedWebOrigin,
        registerPerIpRateLimit,
        asyncHandler(async (req, res) => {
            const authConfig = getPublicAuthConfig();
            if (!authConfig.registrationEnabled) {
                throw new ValidationError(msg('auth.registration_disabled'), null, 'auth.registration_disabled');
            }

            const { username, email, password, theme, preferences } = req.body;

            if (!username || !email || !password) {
                throw new ValidationError(msg('auth.register_fields_required'), null, 'auth.register_fields_required');
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                throw new ValidationError(msg('auth.invalid_email'), null, 'auth.invalid_email');
            }

            if (password.length < 8) {
                throw new ValidationError(msg('auth.password_min_length', { min: 8 }), null, 'auth.password_min_length');
            }

            const prefsPatch = {
                ...(preferences && typeof preferences === 'object' ? preferences : {}),
                ...(theme === 'dark' || theme === 'light' ? { theme } : {})
            };

            const user = await User.create({
                username,
                email,
                password,
                preferences: prefsPatch
            });
            const { user: sessionUser } = issueAppSession(req, res, user);

            recordAuthEvent({
                event: 'register',
                provider: 'local',
                userId: user.id,
                identity: email,
                req
            });

            res.status(201).json({
                message: 'User created successfully',
                user: sessionUser
            });
        })
    );

    /**
     * Login — identity checked by active AUTH_PROVIDER; app always issues its JWT.
     * Body: { identity|username|email, password, otp? }
     */
    app.post(
        '/api/auth/login',
        requireAllowedWebOrigin,
        loginRateLimitMiddleware,
        asyncHandler(async (req, res) => {
            const provider = getAuthProviderName();
            const identity = loginIdentity(req);
            let result;
            try {
                result = await loginWithProvider(req, res, req.body);
            } catch (err) {
                if (err?.code === 'OTP_REQUIRED') {
                    recordAuthEvent({
                        event: 'login_otp_required',
                        provider,
                        identity,
                        req
                    });
                    throw err;
                }
                if (err instanceof ForbiddenError) {
                    noteLoginFailure(req, res, {
                        provider,
                        identity,
                        detail: err.code || 'forbidden'
                    });
                    throw err;
                }
                if (isAuthFailure(err)) {
                    noteLoginFailure(req, res, {
                        provider,
                        identity,
                        detail: err.code || 'unauthorized'
                    });
                }
                throw err;
            }

            if (!result) {
                noteLoginFailure(req, res, {
                    provider,
                    identity,
                    detail: 'invalid_credentials'
                });
                throw new UnauthorizedError(msg('auth.invalid_credentials'), null, 'auth.invalid_credentials');
            }

            recordLoginSuccess(req);
            recordAuthEvent({
                event: 'login_success',
                provider: result.provider,
                userId: result.user.id,
                identity,
                req
            });

            res.json({
                message: 'Login successful',
                user: publicUser(result.user),
                provider: result.provider,
                identity: buildIdentityPayload(result.user.id)
            });
        })
    );

    /**
     * Change password (Directus-linked users update Directus via service token;
     * local-only users update SQLite). Clears must_change_password on success.
     * Body: { currentPassword, newPassword, firstName?, lastName? }
     * firstName/lastName required when the user is Directus-linked.
     */
    app.post(
        '/api/auth/change-password',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { currentPassword, newPassword, firstName, lastName } = req.body || {};
            const min = config.security.passwordMinLength || 8;
            if (!currentPassword || !newPassword) {
                throw new ValidationError(msg('auth.change_password_fields_required'), null, 'auth.change_password_fields_required');
            }
            if (String(newPassword).length < min) {
                throw new ValidationError(msg('auth.password_min_length', { min }), null, 'auth.password_min_length');
            }

            const updated = await changePasswordForUser({
                userId: req.user.id,
                currentPassword,
                newPassword,
                firstName,
                lastName
            });

            const directusTokens = updated?.directusTokens || null;
            if (directusTokens?.accessToken && req.user?.jti) {
                storeProviderTokens(req.user.jti, updated.id, 'directus', {
                    accessToken: directusTokens.accessToken,
                    refreshToken: directusTokens.refreshToken || null,
                    expires: directusTokens.expires
                });
                setDirectusLinkCookie(res, {
                    userId: updated.id,
                    accessToken: directusTokens.accessToken,
                    refreshToken: directusTokens.refreshToken || null,
                    expires: directusTokens.expires
                });
            }

            recordAuthEvent({
                event: 'password_change',
                provider: getAuthProviderName(),
                userId: updated.id,
                identity: updated.email || updated.username,
                req
            });

            res.json({
                message: 'Password updated',
                user: publicUser(updated)
            });
        })
    );

    /**
     * Update display name on the linked Directus user (service token).
     * Body: { firstName, lastName }
     */
    app.put(
        '/api/auth/profile',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const firstName = String(req.body?.firstName || req.body?.first_name || '').trim();
            const lastName = String(req.body?.lastName || req.body?.last_name || '').trim();
            if (!firstName) {
                throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
            }
            if (!lastName) {
                throw new ValidationError(msg('auth.last_name_required'), null, 'auth.last_name_required');
            }

            const user = User.findById(req.user.id);
            if (!user) {
                throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
            }

            const link = findDirectusLinkForUser(user.id);
            if (!link?.external_id) {
                throw new ValidationError(msg('auth.profile_requires_directus'), null, 'auth.profile_requires_directus');
            }

            const { updateDirectusUser, isDirectusConfigured } = await import('../services/directus.js');
            if (!isDirectusConfigured()) {
                throw new ValidationError(msg('directus.not_configured'), null, 'directus.not_configured');
            }

            await updateDirectusUser(link.external_id, { firstName, lastName });

            res.json({
                user: publicUser({
                    ...user,
                    firstName,
                    lastName
                })
            });
        })
    );

    /**
     * Logout
     */
    app.post('/api/auth/logout', requireAllowedWebOrigin, asyncHandler(async (req, res) => {
        logoutCurrentSession(req, res);
        recordAuthEvent({ event: 'logout', provider: getAuthProviderName(), req });
        res.json({ message: 'Logout successful' });
    }));

    /**
     * Get current user info
     */
    app.get('/api/auth/me', authenticateToken, asyncHandler(async (req, res) => {
        const user = User.findById(req.user.id);

        if (!user) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }

        const directusLink = findDirectusLinkForUser(user.id);
        let profile = { ...user };
        if (directusLink?.external_id) {
            try {
                // Prefer service-token read of the linked user — clinician /users/me
                // often omits first_name/last_name under field ACL.
                const { findDirectusUserById, fetchDirectusViewer } = await import('../services/directus.js');
                let firstName = null;
                let lastName = null;
                let email = profile.email;

                const linked = await findDirectusUserById(directusLink.external_id);
                if (linked) {
                    firstName = String(linked.first_name || '').trim() || null;
                    lastName = String(linked.last_name || '').trim() || null;
                    email = linked.email || email;
                }

                if (!firstName && !lastName) {
                    try {
                        const accessToken = await getDirectusAccessTokenForAppUser(req.user, { req, res });
                        const viewer = await fetchDirectusViewer(accessToken);
                        if (viewer) {
                            firstName = viewer.firstName || null;
                            lastName = viewer.lastName || null;
                            if (viewer.name && !firstName && !lastName) {
                                const parts = String(viewer.name).trim().split(/\s+/);
                                firstName = parts[0] || null;
                                lastName = parts.slice(1).join(' ') || null;
                            }
                            email = viewer.email || email;
                        }
                    } catch (_) {
                        // keep service-token result
                    }
                }

                profile = { ...profile, email, firstName, lastName };
            } catch (err) {
                console.warn('auth/me Directus profile enrich skipped:', err.message || err);
            }
        }

        res.json({
            user: publicUser(profile),
            identity: buildIdentityPayload(user.id)
        });
    }));

    /**
     * Update current user preferences (theme, local viewer options).
     */
    app.put('/api/auth/preferences', authenticateToken, asyncHandler(async (req, res) => {
        const before = User.getPreferences(req.user.id);
        if (!before) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }

        const patch = {};
        if (req.body?.theme !== undefined) {
            patch.theme = req.body.theme;
        }
        if (req.body?.useFullSlicer !== undefined) {
            patch.useFullSlicer = req.body.useFullSlicer === true;
        }
        if (req.body?.useSimplifiedViewer !== undefined) {
            patch.useSimplifiedViewer = req.body.useSimplifiedViewer === true;
        }
        if (req.body?.homeLayout !== undefined) {
            patch.homeLayout = req.body.homeLayout;
        }

        const preferences = User.updatePreferences(req.user.id, patch);
        if (!preferences) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }

        const { viewerModeChanged } = await import('../gpu/userPreferences.js');
        if (viewerModeChanged(before, preferences)) {
            try {
                const { stopSlicerGuiSession } = await import('../slicerGui/sessionManager.js');
                await stopSlicerGuiSession({ userId: String(req.user.id) });
            } catch (err) {
                console.warn('Full Slicer recycle after preference change:', err.message);
            }
        }

        res.json({ preferences });
    }));

    /**
     * Re-authenticate the current user with Directus using their password, refreshing
     * the dx_link cookie without ending the app session. Used after the Directus session
     * expires (e.g. after a service restart) so the user stays signed in to the app.
     */
    app.post('/api/auth/directus/reconnect', authenticateToken, asyncHandler(async (req, res) => {
        const { password } = req.body;
        if (!password || typeof password !== 'string') {
            throw new ValidationError('Password is required', null, 'auth.password_required');
        }

        const user = User.findById(req.user.id);
        if (!user?.email) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }

        const base = (config.directus?.url || '').trim().replace(/\/+$/, '');
        if (!base) {
            throw new AppError('Directus not configured', 503, null, 'directus.not_configured');
        }

        const dxRes = await fetch(`${base}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                email: String(user.email).trim().toLowerCase(),
                password: String(password),
                mode: 'json'
            })
        });

        let body = null;
        try { body = await dxRes.json(); } catch { /* */ }

        const data = body?.data || body;
        if (!dxRes.ok || !data?.access_token) {
            throw new UnauthorizedError(msg('auth.current_password_incorrect'), null, 'auth.current_password_incorrect');
        }

        const tokens = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || null,
            expires: data.expires
        };

        if (req.user?.jti) {
            storeProviderTokens(req.user.jti, req.user.id, 'directus', tokens);
            setDirectusLinkCookie(res, {
                userId: req.user.id,
                ...tokens
            });
        }

        res.json({ ok: true });
    }));

    /**
     * Silently refresh the Directus access token while the user is still active.
     * Always returns 200 — failures are intentionally swallowed so a background
     * timer can call this without ever triggering the reconnect modal.
     */
    app.post('/api/auth/directus/keepalive', authenticateToken, asyncHandler(async (req, res) => {
        try {
            await getDirectusAccessTokenForAppUser(req.user, { forceRefresh: true, res });
        } catch {
            // Swallow silently — Directus may be down or the refresh token may be
            // genuinely expired. The reconnect modal handles that when the user
            // next performs a real Directus operation.
        }
        res.json({ ok: true });
    }));

    /**
     * Refresh token (optional - extends session)
     */
    app.post('/api/auth/refresh', requireAllowedWebOrigin, authenticateToken, asyncHandler(async (req, res) => {
        const user = User.findById(req.user.id);

        if (!user) {
            throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
        }

        // Provider tokens are keyed by app session jti — migrate them on rotate
        // so Cases keep working after /api/auth/refresh.
        const priorJti = req.user.jti;
        const priorProviderTokens = priorJti ? getProviderTokens(priorJti) : null;

        const rotated = rotateAppSession(req, res, user);
        if (rotated.previousJti) {
            clearProviderTokens(rotated.previousJti);
        }
        if (priorProviderTokens && rotated.sessionPayload?.jti) {
            storeProviderTokens(rotated.sessionPayload.jti, user.id, 'directus', {
                accessToken: priorProviderTokens.access_token,
                refreshToken: priorProviderTokens.refresh_token,
                expiresAt: priorProviderTokens.expires_at
            });
            setDirectusLinkCookie(res, {
                userId: user.id,
                accessToken: priorProviderTokens.access_token,
                refreshToken: priorProviderTokens.refresh_token,
                expiresAt: priorProviderTokens.expires_at
            });
        } else if (rotated.sessionPayload?.jti) {
            await attachStoredDirectusTokensToSession(req, res, rotated.sessionPayload.jti, user.id);
        }

        res.json({ user: publicUser(user) });
    }));

    /**
     * Logout all sessions (security feature)
     */
    app.post('/api/auth/logout-all', requireAllowedWebOrigin, authenticateToken, asyncHandler(async (req, res) => {
        logoutAllSessions(req.user.id, res);
        try {
            const { cleanupLocalViewerSessionsForUser } = await import('../sessions/cleanup.js');
            await cleanupLocalViewerSessionsForUser(req.user.id);
        } catch (err) {
            console.log('Local viewer cleanup during logout-all:', err.message);
        }
        recordAuthEvent({
            event: 'logout_all',
            provider: getAuthProviderName(),
            userId: req.user.id,
            req
        });
        res.json({ message: 'All sessions terminated' });
    }));
}
