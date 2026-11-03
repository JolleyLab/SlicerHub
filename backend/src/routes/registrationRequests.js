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
import { loginWithProvider } from '../auth/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { sendRegistrationApprovalEmail, sendRegistrationReceivedEmail, isMailConfigured } from '../services/mail.js';
import { notifyNewRequest } from '../services/registrationGroupNotifier.js';

const requireRegistrationAccess = [requireKcGroupCapability(CAPABILITIES.APPROVE_REGISTRATIONS)];

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

            const existingUser = await findUserByEmail(normalized);
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

            await _completeWithKeycloak(req, res, request, { password, firstName, lastName, theme });
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

            const callerIsOrgAdmin = req.user?.role === 'admin' || req.user?.role === 'org-admin';
            const asAdmin = callerIsOrgAdmin && req.body?.asAdmin === true;
            const reviewerSub = req.user?.keycloakSub || null;
            const { token, completionUrl, expiresAt } = await approveRequest(
                request.id,
                asAdmin,
                reviewerSub
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

            const reviewerSub = req.user?.keycloakSub || null;
            await rejectRequest(request.id, reviewerSub);
            res.json({ status: 'rejected' });
        })
    );
}

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

