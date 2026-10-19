import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPayloadClient } from '../payload/index.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors.js';

function requirePayload(req, res, next) {
    if (!getPayloadClient()) {
        return res.status(503).json({
            error: { message: 'Cases service not available — start with --profile payload to enable' }
        });
    }
    next();
}

function assertOwner(doc, userId) {
    if (doc.owner_id !== userId) throw new ForbiddenError();
}

export default function casesRoutes(app) {
    const auth = [authenticateToken, requirePayload];

    /**
     * List cases. Admins see all; regular users see only their own.
     */
    app.get('/api/cases', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const page  = Math.max(Number(req.query.page)  || 1,  1);

        const where = req.user.role === 'admin'
            ? {}
            : { owner_id: { equals: req.user.id } };

        const result = await payload.find({
            collection: 'cases',
            where,
            limit,
            page,
            sort: '-createdAt',
        });

        res.set('Cache-Control', 'no-store');
        res.json({
            cases: result.docs,
            meta: {
                total:      result.totalDocs,
                page:       result.page,
                totalPages: result.totalPages,
                source:     'payload:case',
            },
        });
    }));

    /**
     * Get a single case by ID. Owner or admin only.
     */
    app.get('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload = getPayloadClient();
        const doc = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!doc) throw new NotFoundError('Case not found');
        if (req.user.role !== 'admin') assertOwner(doc, req.user.id);

        res.set('Cache-Control', 'no-store');
        res.json({ case: doc });
    }));

    /**
     * Create a case owned by the logged-in user.
     * Body: { title: string, description?: string, status?: 'active'|'archived' }
     */
    app.post('/api/cases', ...auth, asyncHandler(async (req, res) => {
        const title = String(req.body?.title || '').trim();
        if (!title) throw new ValidationError('Title is required');

        const payload = getPayloadClient();
        const newCase = await payload.create({
            collection: 'cases',
            data: {
                title,
                description: String(req.body?.description || '').trim() || undefined,
                status:      req.body?.status || 'active',
                owner_id:    req.user.id,
            },
        });

        res.status(201).json({ case: newCase });
    }));

    /**
     * Update a case. Owner or admin only.
     * Body: any subset of { title, description, status }
     */
    app.patch('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload  = getPayloadClient();
        const existing = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!existing) throw new NotFoundError('Case not found');
        if (req.user.role !== 'admin') assertOwner(existing, req.user.id);

        const updates = {};
        if (req.body?.title       !== undefined) updates.title       = String(req.body.title).trim();
        if (req.body?.description !== undefined) updates.description = req.body.description;
        if (req.body?.status      !== undefined) updates.status      = req.body.status;

        if (Object.keys(updates).length === 0) {
            return res.json({ case: existing });
        }

        const updated = await payload.update({ collection: 'cases', id: req.params.id, data: updates });
        res.json({ case: updated });
    }));

    /**
     * Delete a case. Owner or admin only.
     */
    app.delete('/api/cases/:id', ...auth, asyncHandler(async (req, res) => {
        const payload  = getPayloadClient();
        const existing = await payload.findByID({ collection: 'cases', id: req.params.id });
        if (!existing) throw new NotFoundError('Case not found');
        if (req.user.role !== 'admin') assertOwner(existing, req.user.id);

        await payload.delete({ collection: 'cases', id: req.params.id });
        res.status(204).end();
    }));
}
