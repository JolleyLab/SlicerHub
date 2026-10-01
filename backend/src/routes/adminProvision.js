/**
 * Org-admin bulk user provision (Pattern A first).
 * Clinicians never open Directus — org admins call this from the product BFF.
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { requireDirectusRole } from '../auth/requireDirectusRole.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAllowedWebOrigin } from '../auth/originCheck.js';
import { recordAuthEvent } from '../auth/auditLog.js';
import { provisionUsersBulk } from '../services/userProvision.js';
import { createRateLimiter, getRateLimitClientIp } from '../middleware/rateLimit.js';
import User from '../models/User.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const requireOrgAdmin = [
    requireDirectusLink,
    requireDirectusUserToken,
    requireDirectusRole('OrgAdmin')
];

const provisionRateLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: msg('admin.provision_rate_limit'),
    getKey: (req) => `admin-provision:ip:${getRateLimitClientIp(req)}:user:${req.user?.id || 'anon'}`
});

export default function adminProvisionRoutes(app) {
    /**
     * POST /api/admin/users/provision
     * Body: {
     *   users: [{ email, firstName?, lastName?, username? }],
     *   method?: "temp_password" | "invite_email",
     *   temporaryPassword?: string  // optional shared password for the batch
     * }
     *
     * Response includes temporaryPassword only for users newly created in Directus.
     * Capture and deliver out-of-band (chat/email); do not log client-side long term.
     */
    app.post(
        '/api/admin/users/provision',
        requireAllowedWebOrigin,
        authenticateToken,
        ...requireOrgAdmin,
        provisionRateLimit,
        asyncHandler(async (req, res) => {
            const result = await provisionUsersBulk(req.body || {});

            recordAuthEvent({
                event: 'admin_user_provision',
                provider: 'admin',
                userId: req.user.id,
                identity: req.user.email || req.user.username,
                detail: `total=${result.summary.total};created=${result.summary.created};errors=${result.summary.errors}`,
                req
            });

            res.status(200).json(result);
        })
    );

    /**
     * Force the password-change gate for users (in the live sql.js process).
     * Body: { emails: ["a@b.com"] } or { allLinked: true }
     */
    app.post(
        '/api/admin/users/require-password-change',
        requireAllowedWebOrigin,
        authenticateToken,
        ...requireOrgAdmin,
        asyncHandler(async (req, res) => {
            const updated = [];
            if (req.body?.allLinked === true) {
                for (const u of User.getAll()) {
                    User.setMustChangePassword(u.id, true);
                    updated.push({ id: u.id, email: u.email });
                }
            } else {
                const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
                if (!emails.length) {
                    throw new ValidationError(
                        msg('admin.require_password_change_body'),
                        null,
                        'admin.require_password_change_body'
                    );
                }
                for (const raw of emails) {
                    const email = String(raw || '').trim();
                    const u = User.findByEmail(email);
                    if (!u) {
                        throw new NotFoundError(
                            msg('user.not_found_for_email', { email }),
                            null,
                            'user.not_found_for_email'
                        );
                    }
                    User.setMustChangePassword(u.id, true);
                    updated.push({ id: u.id, email: u.email, mustChangePassword: true });
                }
            }

            recordAuthEvent({
                event: 'admin_require_password_change',
                provider: 'admin',
                userId: req.user.id,
                identity: req.user.email || req.user.username,
                detail: `count=${updated.length}`,
                req
            });

            res.json({ updated });
        })
    );
}
