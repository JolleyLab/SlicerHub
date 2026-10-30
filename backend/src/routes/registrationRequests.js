/**
 * Registration request flow (org-level signup approval).
 *
 * Public:
 *   POST /api/auth/register-request          — submit a request (no account yet)
 *   GET  /api/auth/register-request/preview  — preview a completion token (like invite preview)
 *   POST /api/auth/register-request/complete — set password and activate account
 *
 * OrgAdmin:
 *   GET  /api/admin/registration-requests         — list pending requests
 *   GET  /api/admin/registration-requests/count   — pending count (bell + home todo)
 *   POST /api/admin/registration-requests/:id/approve — approve + send completion link
 *   POST /api/admin/registration-requests/:id/reject  — reject
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireRole } from '../auth/requireRole.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { requireGroupCapability } from '../auth/requireGroupCapability.js';
import { requireKcGroupCapability } from '../auth/requireKcGroupCapability.js';
import { CAPABILITIES } from '../services/groupCapabilities.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import config from '../config/index.js';
import {
    createRegistrationRequest,
    listPending,
    listRecentlyDecided,
    getById,
    approveRequest,
    rejectRequest,
    findByToken,
    markCompleted,
    REG_STATUS
} from '../services/registrationRequestStore.js';
import {
    findUserByEmail,
    createKeycloakUser,
    setKeycloakUserPassword,
    enableKeycloakUser,
    assignRealmRole,
} from '../services/keycloakAdmin.js';
import { findDirectusUserByEmail } from '../services/directus.js';
import { loginWithProvider } from '../auth/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { sendRegistrationApprovalEmail, sendRegistrationReceivedEmail, isMailConfigured } from '../services/mail.js';
import { notifyNewRequest } from '../services/registrationGroupNotifier.js';

const isKeycloak = config.auth?.provider === 'keycloak';

// Keycloak: capability group membership. Directus: link + token + capability group.
const requireRegistrationAccess = isKeycloak
    ? [requireKcGroupCapability(CAPABILITIES.APPROVE_REGISTRATIONS)]
    : [requireDirectusLink, requireDirectusUserToken, requireGroupCapability(CAPABILITIES.APPROVE_REGISTRATIONS)];

const submitRateLimit = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: msg('registration.rate_limit'),
    getKey: (req) => `reg-request:${getRateLimitClientIp(req)}`
});

export default function registrationRequestRoutes(app) {

    // --- Public: submit a registration request ---
    app.post('/api/auth/register-request',
        submitRateLimit,
        asyncHandler(async (req, res) => {
            const { email, firstName, lastName, affiliation, intendedUse } = req.body || {};

            if (!email || !String(email).includes('@')) {
                throw new ValidationError(msg('auth.email_required'), null, 'auth.email_required');
            }
            if (!firstName || !String(firstName).trim()) {
                throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
            }
            if (!lastName || !String(lastName).trim()) {
                throw new ValidationError(msg('auth.last_name_required'), null, 'auth.last_name_required');
            }

            const normalized = String(email).trim().toLowerCase();

            // Check for an existing account in the active identity provider
            const existingUser = isKeycloak
                ? await findUserByEmail(normalized)
                : await findDirectusUserByEmail(normalized);
            if (existingUser) {
                throw new ConflictError(msg('registration.email_already_registered'), 'EMAIL_ALREADY_REGISTERED', 'registration.email_already_registered');
            }

            let request;
            try {
                request = await createRegistrationRequest({ email, firstName, lastName, affiliation, intendedUse });
            } catch (err) {
                if (err.code === 'DUPLICATE_REGISTRATION') {
                    throw new ConflictError(msg('registration.duplicate'), null, 'registration.duplicate');
                }
                throw err;
            }

            await sendRegistrationReceivedEmail({ to: email, firstName });

            notifyNewRequest().catch(() => { });

            res.status(201).json({ status: 'pending', id: request.id });
        })
    );

    // --- Public: preview a completion token ---
    app.get('/api/auth/register-request/preview',
        requireAllowedWebOrigin,
        asyncHandler(async (req, res) => {
            const token = String(req.query.token || '').trim();
            if (!token) throw new ValidationError(msg('registration.token_required'), null, 'registration.token_required');

            const request = await findByToken(token);
            if (!request) throw new NotFoundError(msg('registration.token_invalid'), null, 'registration.token_invalid');

            res.json({
                email:     request.email,
                firstName: request.firstName,
                lastName:  request.lastName
            });
        })
    );

    // --- Public: complete registration (set password, create account) ---
    app.post('/api/auth/register-request/complete',
        requireAllowedWebOrigin,
        asyncHandler(async (req, res) => {
            const { token: rawToken, password, firstName, lastName, theme } = req.body || {};

            const token = String(rawToken || '').trim();
            if (!token) throw new ValidationError(msg('registration.token_required'), null, 'registration.token_required');
            if (!password || String(password).length < 8) {
                throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
            }

            const request = await findByToken(token);
            if (!request) throw new NotFoundError(msg('registration.token_invalid'), null, 'registration.token_invalid');

            if (isKeycloak) {
                await _completeWithKeycloak(req, res, request, { password, firstName, lastName, theme });
            } else {
                await _completeWithDirectus(req, res, request, { password, firstName, lastName, theme });
            }
        })
    );

    // --- Registration reviewer: pending count ---
    app.get('/api/admin/registration-requests/count',
        authenticateToken,
        ...requireRegistrationAccess,
        asyncHandler(async (_req, res) => {
            const requests = await listPending();
            res.json({ count: requests.length });
        })
    );

    // --- Registration reviewer: list pending + recently decided ---
    app.get('/api/admin/registration-requests',
        authenticateToken,
        ...requireRegistrationAccess,
        asyncHandler(async (_req, res) => {
            const [pending, decided] = await Promise.all([
                listPending(),
                listRecentlyDecided(7).catch(() => [])
            ]);
            res.json({ data: [...pending, ...decided] });
        })
    );

    // --- Registration reviewer: approve ---
    app.post('/api/admin/registration-requests/:id/approve',
        authenticateToken,
        ...requireRegistrationAccess,
        asyncHandler(async (req, res) => {
            const request = await getById(req.params.id);
            if (!request) throw new NotFoundError(msg('registration.not_found'), null, 'registration.not_found');
            if (request.status !== REG_STATUS.PENDING) {
                throw new ValidationError(msg('registration.not_pending'), null, 'registration.not_pending');
            }

            const callerIsOrgAdmin = isKeycloak
                ? (req.user?.role === 'admin' || req.user?.role === 'org-admin')
                : (req.directusProfile?.adminAccess || req.directusProfile?.roleName === 'OrgAdmin');

            const asAdmin = callerIsOrgAdmin && req.body?.asAdmin === true;

            if (!isKeycloak && asAdmin && !config.directus?.orgAdminRoleId) {
                throw new ValidationError('DIRECTUS_ORG_ADMIN_ROLE_ID is not configured', null, 'registration.org_admin_role_not_configured');
            }

            const reviewerSub = isKeycloak ? (req.user?.keycloakSub || null) : null;
            const { token, completionUrl, expiresAt } = await approveRequest(
                request.id,
                asAdmin,
                isKeycloak ? reviewerSub : req.directusAccessToken
            );

            await sendRegistrationApprovalEmail({
                to: request.email,
                firstName: request.firstName,
                completionUrl,
                expiresAt
            });

            const emailWorking = isMailConfigured();
            res.json({
                expiresAt,
                ...(emailWorking ? {} : { token, completionUrl })
            });
        })
    );

    // --- Registration reviewer: reject ---
    app.post('/api/admin/registration-requests/:id/reject',
        authenticateToken,
        ...requireRegistrationAccess,
        asyncHandler(async (req, res) => {
            const request = await getById(req.params.id);
            if (!request) throw new NotFoundError(msg('registration.not_found'), null, 'registration.not_found');
            if (request.status !== REG_STATUS.PENDING) {
                throw new ValidationError(msg('registration.not_pending'), null, 'registration.not_pending');
            }

            const reviewerSub = isKeycloak ? (req.user?.keycloakSub || null) : null;
            await rejectRequest(request.id, isKeycloak ? reviewerSub : req.directusAccessToken);
            res.json({ status: 'rejected' });
        })
    );
}

// ---------------------------------------------------------------------------
// Completion helpers (one per identity provider)
// ---------------------------------------------------------------------------

async function _completeWithKeycloak(req, res, request, { password, firstName, lastName, theme }) {
    const email = request.email;

    const existing = await findUserByEmail(email);
    if (existing) throw new ConflictError(msg('case.signup_email_exists'), null, 'case.signup_email_exists');

    const fn = String(firstName || request.firstName || '').trim();
    const ln = String(lastName  || request.lastName  || '').trim();

    // Create disabled KC user, set password, enable
    const kcUser = await createKeycloakUser({ email, firstName: fn, lastName: ln });
    await setKeycloakUserPassword(kcUser.id, String(password));
    await enableKeycloakUser(kcUser.id, { firstName: fn, lastName: ln });

    if (request.isOrgAdmin) {
        await assignRealmRole(kcUser.id, 'app-org-admin');
    }

    await markCompleted(request.id);

    // Log the user in immediately — keycloak provider creates the shadow user automatically
    const result = await loginWithProvider(req, res, { identity: email, password: String(password) });
    if (!result) {
        // Account created but login failed — should not happen
        return res.status(201).json({ status: 'completed' });
    }

    if (theme === 'dark' || theme === 'light') {
        // Theme is stored in UserPreferences by the settings route; nothing to do here
    }

    res.json({ status: 'completed', user: result.user });
}

async function _completeWithDirectus(req, res, request, { password, firstName, lastName, theme }) {
    // Lazy import so the Directus path only loads when actually used
    const { default: User } = await import('../models/User.js');
    const { createDirectusUser, findDirectusUserByEmail } = await import('../services/directus.js');
    const { linkIdentity, findLink, findDirectusLinkForUser } = await import('../auth/identityStore.js');
    const { issueAppSession } = await import('../auth/session.js');
    const { setDirectusLinkCookie } = await import('../auth/directusLinkCookie.js');
    const { storeProviderTokens } = await import('../auth/identityStore.js');

    const PROVIDER = 'directus';
    const email = request.email;

    if (!config.directus?.defaultRoleId) {
        throw new ValidationError(msg('case.signup_invite_directus_misconfigured'), null, 'case.signup_invite_directus_misconfigured');
    }

    const existing = await findDirectusUserByEmail(email);
    if (existing) throw new ConflictError(msg('case.signup_email_exists'), null, 'case.signup_email_exists');

    const roleId = (request.isOrgAdmin && config.directus?.orgAdminRoleId)
        ? config.directus.orgAdminRoleId
        : config.directus.defaultRoleId;

    const directusUser = await createDirectusUser({
        email,
        password: String(password),
        roleId,
        firstName: String(firstName || request.firstName || '').trim(),
        lastName:  String(lastName  || request.lastName  || '').trim()
    });
    const directusUserId = String(directusUser.id);

    let localUser = User.findByEmail(email);
    if (localUser) {
        const other = findDirectusLinkForUser(localUser.id);
        if (other && String(other.external_id) !== directusUserId) {
            throw new ConflictError(msg('auth.email_linked_elsewhere'), null, 'auth.email_linked_elsewhere');
        }
    } else {
        localUser = await User.createExternalShadow({ email });
    }
    if (!findLink(PROVIDER, directusUserId)) {
        linkIdentity(localUser.id, PROVIDER, directusUserId);
    }

    if (theme === 'dark' || theme === 'light') {
        User.updatePreferences(localUser.id, { theme });
    }

    await markCompleted(request.id);

    const loginRes = await fetch(
        `${(config.directus.url || '').replace(/\/+$/, '')}/auth/login`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email, password: String(password) })
        }
    );
    const loginBody = loginRes.ok ? await loginRes.json() : null;
    const loginData = loginBody?.data || loginBody;
    const externalTokens = loginData?.access_token ? {
        accessToken:  loginData.access_token,
        refreshToken: loginData.refresh_token || null,
        expires:      loginData.expires,
        expiresAt:    loginData.expires
            ? new Date(Date.now() + Number(loginData.expires)).toISOString()
            : null
    } : null;

    const { user: sessionUser, sessionPayload } = issueAppSession(req, res, {
        ...localUser,
        firstName: directusUser.first_name || '',
        lastName:  directusUser.last_name  || ''
    });

    if (config.auth?.storeProviderTokens && externalTokens && sessionPayload?.jti) {
        storeProviderTokens(sessionPayload.jti, localUser.id, PROVIDER, externalTokens);
        setDirectusLinkCookie(res, {
            userId:       localUser.id,
            accessToken:  externalTokens.accessToken,
            refreshToken: externalTokens.refreshToken,
            expiresAt:    externalTokens.expiresAt,
            expires:      externalTokens.expires
        });
    }

    res.json({ status: 'completed', user: sessionUser });
}
