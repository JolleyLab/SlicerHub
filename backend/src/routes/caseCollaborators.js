/**
 * Collaborator management routes for Payload cases.
 *
 * Role storage: Keycloak Groups (case:{caseId}:{role}).
 * No separate Payload collection — Keycloak is the source of truth for access.
 */

import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { assertCaseAccess } from '../utils/caseAccess.js';
import {
    CASE_ROLES,
    findUserByEmail,
    addUserToCaseGroup,
    removeUserFromAllCaseGroups,
    listCaseCollaborators,
    getKeycloakSubForUser,
} from '../services/keycloakAdmin.js';
import config from '../config/index.js';

function requirePayload(req, res, next) {
    if (!getPayloadClient()) {
        return res.status(503).json({
            error: { message: 'Cases service not available' }
        });
    }
    next();
}

function requireKeycloak(req, res, next) {
    if (config.auth.provider !== 'keycloak') {
        return res.status(503).json({
            error: { message: 'Collaborator management requires Keycloak (AUTH_PROVIDER=keycloak)' }
        });
    }
    next();
}

export default function caseCollaboratorsRoutes(app) {
    const auth = [authenticateToken, requirePayload, requireKeycloak];

    /**
     * Look up a Keycloak user by email (for the invite dialog search).
     * Returns basic profile if found, 404 if no account with that email.
     */
    app.get('/api/cases/lookup-user', ...auth, asyncHandler(async (req, res) => {
        const email = String(req.query.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
            throw new ValidationError('Valid email required');
        }

        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(404).json({ error: { message: 'No account found with that email address' } });
        }

        res.json({ user });
    }));

    /**
     * List all collaborators on a case.
     * Readable by any collaborator (including read_only).
     */
    app.get('/api/cases/:id/collaborators', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'read_only');

        const collaborators = await listCaseCollaborators(req.params.id);

        res.set('Cache-Control', 'no-store');
        res.json({ collaborators });
    }));

    /**
     * Invite a user to a case by email.
     * Adds them to the appropriate Keycloak group immediately (no email invite flow for now).
     * Access: case admin only.
     */
    app.post('/api/cases/:id/invites', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        const email = String(req.body?.email || '').trim().toLowerCase();
        const role  = String(req.body?.role  || 'collaborator');

        if (!email || !email.includes('@')) throw new ValidationError('Valid email required');
        if (!CASE_ROLES.includes(role)) {
            throw new ValidationError(`Role must be one of: ${CASE_ROLES.join(', ')}`);
        }

        const user = await findUserByEmail(email);
        if (!user) {
            return res.status(404).json({
                error: { message: 'No account found with that email address. Ask them to sign up first.' }
            });
        }

        // Prevent adding the owner as a collaborator
        const ownerKeycloakSub = getKeycloakSubForUser(doc.owner_id);
        if (ownerKeycloakSub && ownerKeycloakSub === user.id) {
            return res.status(409).json({
                error: { message: 'The case owner already has admin access' }
            });
        }

        await addUserToCaseGroup(user.id, req.params.id, role);

        res.status(201).json({ collaborator: { ...user, role } });
    }));

    /**
     * Bulk-update collaborators on a case (People dialog Save).
     * Body: { collaborators: [{ id: keycloakUserId, role }] }
     * Reconciles Keycloak groups:
     *   - Users in the new list get their role set.
     *   - Users not in the new list are removed from all case groups.
     * Access: case admin only.
     */
    app.put('/api/cases/:id/collaborators', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        const incoming = req.body?.collaborators;
        if (!Array.isArray(incoming)) throw new ValidationError('collaborators must be an array');

        // Validate all entries before making any changes
        for (const entry of incoming) {
            if (!entry.id) throw new ValidationError('Each collaborator must have an id (Keycloak user ID)');
            if (!CASE_ROLES.includes(entry.role)) {
                throw new ValidationError(`Invalid role "${entry.role}". Must be one of: ${CASE_ROLES.join(', ')}`);
            }
        }

        const current = await listCaseCollaborators(req.params.id);
        const incomingIds = new Set(incoming.map(c => c.id));
        const currentIds  = new Set(current.map(c => c.id));

        // Remove collaborators no longer in the list
        for (const c of current) {
            if (!incomingIds.has(c.id)) {
                await removeUserFromAllCaseGroups(c.id, req.params.id);
            }
        }

        // Add or update roles for everyone in the new list
        for (const entry of incoming) {
            const existing = current.find(c => c.id === entry.id);
            if (!existing || existing.role !== entry.role) {
                await addUserToCaseGroup(entry.id, req.params.id, entry.role);
            }
        }

        const updated = await listCaseCollaborators(req.params.id);
        res.json({ collaborators: updated });
    }));

    /**
     * Remove a single collaborator from a case.
     * Access: case admin only.
     */
    app.delete('/api/cases/:id/collaborators/:keycloakUserId', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');

        await assertCaseAccess(doc, req, 'admin');

        await removeUserFromAllCaseGroups(req.params.keycloakUserId, req.params.id);
        res.status(204).end();
    }));
}
