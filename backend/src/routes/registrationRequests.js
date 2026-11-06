/**
 * Registration review (approval gate).
 *
 * People request access on Keycloak's sign-up page; their first sign-in creates the
 * review item (routes/auth.js, /api/auth/me). Reviewers:
 *   GET  /api/admin/registration-requests            — list pending + recently decided
 *   GET  /api/admin/registration-requests/count      — pending count (bell + home todo)
 *   POST /api/admin/registration-requests/:id/approve — grant app-user (+ app-org-admin)
 *   POST /api/admin/registration-requests/:id/reject  — delete the Keycloak account
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireKcGroupCapability } from '../auth/requireKcGroupCapability.js';
import { CAPABILITIES } from '../services/groupCapabilities.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import config from '../config/index.js';
import {
    listPending,
    listRecentlyDecided,
    getById,
    rejectRequest,
    markAccountApproved,
    REG_STATUS
} from '../services/registrationRequestStore.js';
import {
    assignRealmRole,
    deleteKeycloakUser,
    clearRegistrationAttributes,
} from '../services/keycloakAdmin.js';
import { forgetAccount } from '../auth/accountRefresh.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import { sendAccessApprovedEmail } from '../services/mail.js';

const requireRegistrationAccess = [requireKcGroupCapability(CAPABILITIES.APPROVE_REGISTRATIONS)];

export default function registrationRequestRoutes(app) {

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

            // Every request is an existing Keycloak account (sign-up page or hospital SSO).
            // A record from the old app-run flow has none: ask them to sign up again.
            if (!request.keycloakSub) {
                throw new ValidationError(msg('registration.legacy_request'), 'LEGACY_REQUEST', 'registration.legacy_request');
            }
            await assignRealmRole(request.keycloakSub, 'app-user');
            if (asAdmin) await assignRealmRole(request.keycloakSub, 'app-org-admin');
            await markAccountApproved(request.id, asAdmin, reviewerSub);
            forgetAccount(request.keycloakSub); // takes effect on their next request
            // The review record keeps affiliation/intended use (cleared after 30 days);
            // the Keycloak account doesn't need them.
            await clearRegistrationAttributes(request.keycloakSub).catch((err) =>
                console.warn('[registration] Could not clear registration attributes:', err.message));
            await sendAccessApprovedEmail({
                to: request.email,
                firstName: request.firstName,
                signInUrl: `${config.publicAppUrl}/`,
            });
            res.json({ approved: true });
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
            // Account request: the account was never allowed in; remove it
            // (design decision: reject = delete the Keycloak account).
            if (request.keycloakSub) {
                await deleteKeycloakUser(request.keycloakSub);
                forgetAccount(request.keycloakSub);
            }
            await rejectRequest(request.id, reviewerSub);
            res.json({ status: 'rejected' });
        })
    );
}
