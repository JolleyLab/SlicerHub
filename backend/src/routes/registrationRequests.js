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
 *   POST /api/admin/registration-requests/:id/approve — approve + get completion link
 *   POST /api/admin/registration-requests/:id/reject  — reject
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { requireDirectusRole } from '../auth/requireDirectusRole.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import {
    createRegistrationRequest,
    listPending,
    getById,
    approveRequest,
    rejectRequest,
    findByToken,
    markCompleted,
    REG_STATUS
} from '../services/registrationRequestStore.js';
import { createDirectusUser, findDirectusUserByEmail } from '../services/directus.js';
import User from '../models/User.js';
import { linkIdentity, findLink, findDirectusLinkForUser } from '../auth/identityStore.js';
import { issueAppSession } from '../auth/session.js';
import { setDirectusLinkCookie } from '../auth/directusLinkCookie.js';
import { storeProviderTokens } from '../auth/identityStore.js';
import config from '../config/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { sendRegistrationApprovalEmail } from '../services/mail.js';

const PROVIDER = 'directus';

const requireOrgAdmin = [
    requireDirectusLink,
    requireDirectusUserToken,
    requireDirectusRole('OrgAdmin', 'Administrator')
];

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

            let request;
            try {
                request = await createRegistrationRequest({ email, firstName, lastName, affiliation, intendedUse });
            } catch (err) {
                if (err.code === 'DUPLICATE_REGISTRATION') {
                    throw new ConflictError(msg('registration.duplicate'), null, 'registration.duplicate');
                }
                throw err;
            }

            res.status(201).json({ status: 'pending', id: request.id });
        })
    );

    // --- Public: preview a completion token (validate before showing the form) ---
    app.get('/api/auth/register-request/preview',
        requireAllowedWebOrigin,
        asyncHandler(async (req, res) => {
            const token = String(req.query.token || '').trim();
            if (!token) throw new ValidationError(msg('registration.token_required'), null, 'registration.token_required');

            const request = await findByToken(token);
            if (!request) throw new NotFoundError(msg('registration.token_invalid'), null, 'registration.token_invalid');

            res.json({
                email: request.email,
                firstName: request.firstName,
                lastName: request.lastName
            });
        })
    );

    // --- Public: complete registration (set password, create Directus account) ---
    app.post('/api/auth/register-request/complete',
        requireAllowedWebOrigin,
        asyncHandler(async (req, res) => {
            const { token: rawToken, password, firstName, lastName, theme } = req.body || {};

            const token = String(rawToken || '').trim();
            if (!token) throw new ValidationError(msg('registration.token_required'), null, 'registration.token_required');
            if (!password || String(password).length < 8) {
                throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
            }
            if (!config.directus.defaultRoleId) {
                throw new ValidationError(msg('case.signup_invite_directus_misconfigured'), null, 'case.signup_invite_directus_misconfigured');
            }

            const request = await findByToken(token);
            if (!request) throw new NotFoundError(msg('registration.token_invalid'), null, 'registration.token_invalid');

            const email = request.email;

            // Guard against double-completion
            const existing = await findDirectusUserByEmail(email);
            if (existing) throw new ConflictError(msg('case.signup_email_exists'), null, 'case.signup_email_exists');

            const roleId = (request.isOrgAdmin && config.directus.orgAdminRoleId)
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

            // Log the user in immediately
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
        })
    );

    // --- OrgAdmin: pending count (lightweight, used by bell + home todo) ---
    app.get('/api/admin/registration-requests/count',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (_req, res) => {
            const requests = await listPending();
            res.json({ count: requests.length });
        })
    );

    // --- OrgAdmin: list pending requests ---
    app.get('/api/admin/registration-requests',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (_req, res) => {
            const requests = await listPending();
            res.json({ data: requests });
        })
    );

    // --- OrgAdmin: approve a request ---
    app.post('/api/admin/registration-requests/:id/approve',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const request = await getById(req.params.id);
            if (!request) throw new NotFoundError(msg('registration.not_found'), null, 'registration.not_found');
            if (request.status !== REG_STATUS.PENDING) {
                throw new ValidationError(msg('registration.not_pending'), null, 'registration.not_pending');
            }

            const asAdmin = req.body?.asAdmin === true;
            if (asAdmin && !config.directus.orgAdminRoleId) {
                throw new ValidationError('DIRECTUS_ORG_ADMIN_ROLE_ID is not configured', null, 'registration.org_admin_role_not_configured');
            }
            const { token, completionUrl, expiresAt } = await approveRequest(request.id, asAdmin);

            await sendRegistrationApprovalEmail({
                to: request.email,
                firstName: request.firstName,
                completionUrl,
                expiresAt
            });

            res.json({ token, completionUrl, expiresAt });
        })
    );

    // --- OrgAdmin: reject a request ---
    app.post('/api/admin/registration-requests/:id/reject',
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const request = await getById(req.params.id);
            if (!request) throw new NotFoundError(msg('registration.not_found'), null, 'registration.not_found');
            if (request.status !== REG_STATUS.PENDING) {
                throw new ValidationError(msg('registration.not_pending'), null, 'registration.not_pending');
            }

            await rejectRequest(request.id);
            res.json({ status: 'rejected' });
        })
    );
}
