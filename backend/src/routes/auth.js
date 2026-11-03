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
    findLinkForUser,
    clearProviderTokens
} from '../auth/identityStore.js';
import { getKeycloakSubForUser, getKeycloakUser, updateKeycloakUserProfile } from '../services/keycloakAdmin.js';
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
import { isUserInCapabilityGroup, CAPABILITIES } from '../services/groupCapabilities.js';
import { getPreferencesByKcSub, updatePreferencesByKcSub, hasCustomPreferences } from '../services/payloadPreferences.js';
import storage from '../storage/index.js';

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const AVATAR_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

async function findKcAvatarKey(kcSub) {
    const prefix = storage.avatarKeyForSub(kcSub, '').replace(/\.$/, '');
    const keys = await storage.listByPrefix(prefix);
    return keys.length > 0 ? keys[0] : null;
}


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
    const preferredName = String(user?.preferredName || '').trim() || null;
    const email = String(user?.email || '').trim() || null;
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
        id: user.id,
        username: user.username,
        email,
        firstName,
        lastName,
        preferredName,
        displayName: preferredName || fullName || email || String(user?.username || '').trim() || 'Guest',
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

            let userPayload = publicUser(result.user);
            const kcSub = result.user.keycloakSub || getKeycloakSubForUser(result.user.id);
            if (kcSub) {
                try {
                    const [prefs, hasPrefs] = await Promise.all([
                        getPreferencesByKcSub(kcSub),
                        hasCustomPreferences(kcSub),
                    ]);
                    userPayload = { ...userPayload, preferences: prefs, hasCustomPreferences: hasPrefs };
                } catch (err) {
                    console.warn('[login] Could not load preferences:', err.message);
                }
            }
            res.json({
                message: 'Login successful',
                user: userPayload,
                provider: result.provider,
                identity: { keycloakLinked: true, directusLinked: false, directusLinkRequired: false }
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

    /** Update display name. Body: { firstName, lastName, preferredName? } */
    app.put(
        '/api/auth/profile',
        requireAllowedWebOrigin,
        authenticateToken,
        asyncHandler(async (req, res) => {
            const firstName     = String(req.body?.firstName    || req.body?.first_name    || '').trim();
            const lastName      = String(req.body?.lastName     || req.body?.last_name     || '').trim();
            const preferredName = String(req.body?.preferredName ?? '').trim().slice(0, 80);
            if (!firstName) throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
            if (!lastName)  throw new ValidationError(msg('auth.last_name_required'),  null, 'auth.last_name_required');

            const user = User.findById(req.user.id);
            if (!user) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');

            const kcLink = findLinkForUser(user.id, 'keycloak');
            if (!kcLink?.external_id) {
                throw new ValidationError('No Keycloak identity linked to this account.', null, null);
            }

            await updateKeycloakUserProfile(kcLink.external_id, { firstName, lastName, preferredName });

            const { user: updatedUser } = issueAppSession(req, res, { ...user, firstName, lastName });
            return res.json({ user: publicUser({ ...updatedUser, preferredName: preferredName || null }) });
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
        const kcSub = req.user.keycloakSub || getKeycloakSubForUser(req.user.id);
        const [preferences, hasPrefs, avatarKey, kcProfile] = await Promise.all([
            getPreferencesByKcSub(kcSub),
            hasCustomPreferences(kcSub),
            findKcAvatarKey(kcSub),
            kcSub ? getKeycloakUser(kcSub).catch(() => null) : null,
        ]);
        const isOrgAdmin = req.user.role === 'admin' || req.user.role === 'org-admin';
        const isRegistrationReviewer = kcSub
            ? await isUserInCapabilityGroup(kcSub, CAPABILITIES.APPROVE_REGISTRATIONS).catch(() => false)
            : false;
        const avatarUrl = avatarKey ? `/api/auth/avatar?v=${Date.now()}` : null;
        const preferredName = kcProfile?.preferredName || null;
        const firstName = req.user.firstName || null;
        const lastName  = req.user.lastName  || null;
        const fullName  = [firstName, lastName].filter(Boolean).join(' ').trim();

        res.json({
            user: {
                id: req.user.id,
                username: req.user.username,
                email: req.user.email || null,
                firstName,
                lastName,
                preferredName,
                displayName: preferredName || fullName || req.user.username || 'Guest',
                role: req.user.role,
                avatarUrl,
                preferences,
                hasCustomPreferences: hasPrefs,
            },
            identity: {
                keycloakLinked: true,
                directusLinked: false,
                directusLinkRequired: false,
            },
            isOrgAdmin,
            isRegistrationReviewer,
            directusUserId: null,
            keycloakSub: kcSub,
        });
    }));

    /**
     * Update current user preferences (theme, local viewer options).
     * Keycloak users: stored in Payload user-preferences collection.
     * Local-auth users: stored in SQLite (legacy path, until SQLite is removed).
     */
    app.put('/api/auth/preferences', authenticateToken, asyncHandler(async (req, res) => {
        const kcSub = req.user.keycloakSub
            || (config.auth.provider === 'keycloak' ? getKeycloakSubForUser(req.user.id) : null);

        const patch = {};
        if (req.body?.theme !== undefined) patch.theme = req.body.theme;
        if (req.body?.useFullSlicer !== undefined) patch.useFullSlicer = req.body.useFullSlicer === true;
        if (req.body?.useSimplifiedViewer !== undefined) patch.useSimplifiedViewer = req.body.useSimplifiedViewer === true;
        if (req.body?.homeLayout !== undefined) patch.homeLayout = req.body.homeLayout;
        if (req.body?.slicerWebChannel !== undefined) patch.slicerWebChannel = req.body.slicerWebChannel === 'latest' ? 'latest' : 'stable';
        if (req.body?.notifyRegistrationApproval !== undefined) patch.notifyRegistrationApproval = req.body.notifyRegistrationApproval === true;
        if (req.body?.activityFilters !== undefined) patch.activityFilters = req.body.activityFilters;

        let preferences;
        if (kcSub) {
            const { viewerModeChanged } = await import('../gpu/userPreferences.js');
            const before = await getPreferencesByKcSub(kcSub);
            preferences = await updatePreferencesByKcSub(kcSub, patch);
            if (viewerModeChanged(before, preferences)) {
                try {
                    const { stopSlicerGuiSession } = await import('../slicerGui/sessionManager.js');
                    await stopSlicerGuiSession({ userId: String(req.user.id) });
                } catch (err) {
                    console.warn('Full Slicer recycle after preference change:', err.message);
                }
            }
        } else {
            // Local-auth fallback — SQLite path (goes away when SQLite is removed)
            const before = User.getPreferences(req.user.id);
            if (!before) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
            preferences = User.updatePreferences(req.user.id, patch);
            if (!preferences) throw new NotFoundError(msg('user.not_found'), null, 'user.not_found');
            const { viewerModeChanged } = await import('../gpu/userPreferences.js');
            if (viewerModeChanged(before, preferences)) {
                try {
                    const { stopSlicerGuiSession } = await import('../slicerGui/sessionManager.js');
                    await stopSlicerGuiSession({ userId: String(req.user.id) });
                } catch (err) {
                    console.warn('Full Slicer recycle after preference change:', err.message);
                }
            }
        }

        res.json({ preferences });
    }));

    /** Upload or replace the current user's avatar. KC users: stored on disk. Local-auth: Directus. */
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
        const finalExt = (originalname || '').split('.').pop().toLowerCase() || 'jpg';
        const existingKey = await findKcAvatarKey(req.user.keycloakSub);
        if (existingKey) await storage.delete(existingKey);
        const key = storage.avatarKeyForSub(req.user.keycloakSub, finalExt);
        await storage.write({ key, buffer, contentType: AVATAR_MIME[finalExt] || 'application/octet-stream' });
        res.json({ ok: true, avatarUrl: `/api/auth/avatar?v=${Date.now()}` });
    }));

    /** Serve the current user's avatar. */
    app.get('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const key = await findKcAvatarKey(req.user.keycloakSub);
        if (!key) return res.status(404).end();
        const presigned = await storage.getPresignedReadUrl(key, 300);
        if (presigned) return res.redirect(302, presigned);
        const ext = key.split('.').pop().toLowerCase();
        res.setHeader('Content-Type', AVATAR_MIME[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return (await storage.openReadStream(key)).pipe(res);
    }));

    /** Remove the current user's avatar. */
    app.delete('/api/auth/avatar', authenticateToken, asyncHandler(async (req, res) => {
        const key = await findKcAvatarKey(req.user.keycloakSub);
        if (key) await storage.delete(key);
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

        const rotated = rotateAppSession(req, res, user);
        if (rotated.previousJti) {
            clearProviderTokens(rotated.previousJti);
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
