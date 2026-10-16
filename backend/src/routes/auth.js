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
    findLinkForUser,
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
import multer from 'multer';
import heicConvert from 'heic-convert';
import { uploadDirectusAvatar, updateDirectusUser, findDirectusUserById, sendDirectusAsset, isDirectusConfigured, fetchDirectusCurrentUser as fetchDirectusViewer, directusFetch } from '../services/directus.js';
import { isOrgAdminByRole } from '../auth/orgAdminUtils.js';
import { isUserInCapabilityGroup, CAPABILITIES } from '../services/groupCapabilities.js';

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
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
        preferences: user.preferences,
        avatarUrl: user.avatarUrl || null
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
     * Update display name. Body: { firstName, lastName }
     * Keycloak: updates Keycloak user + re-issues session JWT (no DB write).
     * Directus: updates Directus user (legacy).
     */
    app.put(
        '/api/auth/profile',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const firstName = String(req.body?.firstName || req.body?.first_name || '').trim();
            const lastName  = String(req.body?.lastName  || req.body?.last_name  || '').trim();
            if (!firstName) throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
            if (!lastName)  throw new ValidationError(msg('auth.last_name_required'),  null, 'auth.last_name_required');

            const user = User.findById(req.user.id);
            if (!user) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');

            if (config.auth.provider === 'keycloak') {
                const kcLink = findLinkForUser(user.id, 'keycloak');
                if (!kcLink?.external_id) {
                    throw new ValidationError('No Keycloak identity linked to this account.', null, null);
                }

                // Update Keycloak user
                const { url, realm, adminUser, adminPassword } = config.keycloak;
                const tokenRes = await fetch(`${url}/realms/master/protocol/openid-connect/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUser, password: adminPassword })
                });
                if (!tokenRes.ok) throw new AppError('Keycloak admin token failed', 502);
                const { access_token } = await tokenRes.json();

                const patchRes = await fetch(
                    `${url}/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(kcLink.external_id)}`,
                    {
                        method: 'PUT',
                        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ firstName, lastName })
                    }
                );
                if (!patchRes.ok) {
                    const t = await patchRes.text().catch(() => '');
                    throw new AppError(`Keycloak profile update failed (${patchRes.status}): ${t}`, 502);
                }

                // Re-issue the session JWT so the updated name is in req.user immediately
                // without requiring the user to log out and back in.
                const { user: updatedUser } = issueAppSession(req, res, { ...user, firstName, lastName });
                return res.json({ user: publicUser(updatedUser) });
            }

            // Directus path (unchanged)
            const link = findDirectusLinkForUser(user.id);
            if (!link?.external_id) {
                throw new ValidationError(msg('auth.profile_requires_directus'), null, 'auth.profile_requires_directus');
            }
            if (!isDirectusConfigured()) {
                throw new ValidationError(msg('directus.not_configured'), null, 'directus.not_configured');
            }
            await updateDirectusUser(link.external_id, { firstName, lastName });
            res.json({ user: publicUser({ ...user, firstName, lastName }) });
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
        // Keycloak: firstName/lastName live in Keycloak and are carried in the session JWT.
        let profile = config.auth.provider === 'keycloak'
            ? { ...user, firstName: req.user.firstName || null, lastName: req.user.lastName || null }
            : { ...user };
        let isOrgAdmin = false;
        if (directusLink?.external_id) {
            try {
                // Prefer service-token read of the linked user — clinician /users/me
                // often omits first_name/last_name under field ACL.
                let firstName = null;
                let lastName = null;
                let email = profile.email;
                let avatarUrl = null;

                const linked = await findDirectusUserById(directusLink.external_id);
                if (linked) {
                    firstName = String(linked.first_name || '').trim() || null;
                    lastName = String(linked.last_name || '').trim() || null;
                    email = linked.email || email;
                    avatarUrl = linked.avatar ? `/api/auth/avatar?v=${Date.now()}` : null;
                    isOrgAdmin = isOrgAdminByRole(linked.role);
                }

                try {
                    const accessToken = await getDirectusAccessTokenForAppUser(req.user, { req, res });
                    const currentUser = await fetchDirectusViewer(accessToken);
                    if (currentUser) {
                        if (!firstName && !lastName) {
                            firstName = currentUser.firstName || null;
                            lastName = currentUser.lastName || null;
                            if (currentUser.name && !firstName && !lastName) {
                                const parts = String(currentUser.name).trim().split(/\s+/);
                                firstName = parts[0] || null;
                                lastName = parts.slice(1).join(' ') || null;
                            }
                            email = currentUser.email || email;
                        }
                        isOrgAdmin = isOrgAdminByRole(currentUser);
                    }
                } catch (_) {
                    // keep service-token result above
                }

                profile = { ...profile, email, firstName, lastName, avatarUrl };
            } catch (err) {
                console.warn('auth/me Directus profile enrich skipped:', err.message || err);
            }
        }

        // Group membership is the single source of truth for reviewer access.
        let isRegistrationReviewer = false;
        if (directusLink?.external_id) {
            try {
                isRegistrationReviewer = await isUserInCapabilityGroup(
                    directusLink.external_id,
                    CAPABILITIES.APPROVE_REGISTRATIONS
                );
            } catch (_) {
                // non-fatal — leave as false
            }
        }

        // Read notifyRegistrationApproval from Directus — opt-out, default true.
        let notifyRegistrationApproval = true;
        if (directusLink?.external_id) {
            try {
                const prefPayload = await directusFetch(`/users/${encodeURIComponent(directusLink.external_id)}`, {
                    query: { fields: 'notify_registration_approval' }
                });
                if (prefPayload?.data?.notify_registration_approval === false) {
                    notifyRegistrationApproval = false;
                }
            } catch (_) {
                // field may not exist in Directus yet — default to true
            }
        }

        const baseUser = publicUser(profile);
        res.json({
            user: {
                ...baseUser,
                preferences: { ...baseUser.preferences, notifyRegistrationApproval }
            },
            identity: buildIdentityPayload(user.id),
            isOrgAdmin,
            isRegistrationReviewer,
            directusUserId: directusLink?.external_id || null
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
        if (req.body?.slicerWebChannel !== undefined) {
            patch.slicerWebChannel = req.body.slicerWebChannel === 'latest' ? 'latest' : 'stable';
        }
        // notifyRegistrationApproval lives on the Directus user
        if (req.body?.notifyRegistrationApproval !== undefined) {
            const link = findDirectusLinkForUser(req.user.id);
            if (link?.external_id) {
                directusFetch(`/users/${encodeURIComponent(link.external_id)}`, {
                    method: 'PATCH',
                    body: { notify_registration_approval: req.body.notifyRegistrationApproval === true }
                }).catch(err => console.warn('Directus notify pref save failed:', err?.message));
            }
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

    /** Upload or replace the current user's Directus avatar. */
    app.post('/api/auth/avatar', authenticateToken, avatarUpload.single('avatar'), asyncHandler(async (req, res) => {
        if (!req.file) throw new ValidationError(msg('avatar.required'), null, 'avatar.required');
        let { buffer, mimetype, originalname } = req.file;
        const ext = (originalname || '').split('.').pop().toLowerCase();
        if (ext === 'heic' || ext === 'heif') {
            const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.85 });
            buffer = Buffer.from(converted);
            mimetype = 'image/jpeg';
            originalname = originalname.replace(/\.(heic|heif)$/i, '.jpg');
        }
        const link = findDirectusLinkForUser(req.user.id);
        if (!link?.external_id) throw new NotFoundError(msg('directus.not_linked'), null, 'directus.not_linked');
        const accessToken = await getDirectusAccessTokenForAppUser(req.user, { res });
        const fileId = await uploadDirectusAvatar(accessToken, buffer, mimetype, originalname);
        await updateDirectusUser(link.external_id, { avatar: fileId });
        res.json({ ok: true, avatarUrl: `/api/auth/avatar?v=${Date.now()}` });
    }));

    /** Proxy the current user's Directus avatar image. */
    app.get('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const link = findDirectusLinkForUser(req.user.id);
        if (!link?.external_id) return res.status(404).end();
        const directusUser = await findDirectusUserById(link.external_id);
        if (!directusUser?.avatar) return res.status(404).end();
        const accessToken = await getDirectusAccessTokenForAppUser(req.user, { res });
        await sendDirectusAsset(res, directusUser.avatar, accessToken);
    }));

    /** Remove the current user's avatar. */
    app.delete('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const link = findDirectusLinkForUser(req.user.id);
        if (!link?.external_id) throw new NotFoundError(msg('directus.not_linked'), null, 'directus.not_linked');
        await updateDirectusUser(link.external_id, { avatar: null });
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
            console.warn('Local viewer cleanup during logout-all:', err.message);
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
