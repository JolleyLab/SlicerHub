import Project, { ROLE_ENUM } from '../models/Project.js';
import User from '../models/User.js';
import File from '../models/File.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export default function projectRoutes(app) {
    app.get('/api/projects', authenticateToken, asyncHandler(async (req, res) => {
        const limitRaw = Number(req.query.limit ?? 20);
        const offsetRaw = Number(req.query.offset ?? 0);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
        const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

        const userId = req.user.id;
        const total = Project.countForUser(userId);
        const projects = Project.listForUser({ userId, limit, offset });

        res.json({
            projects,
            pagination: {
                limit,
                offset,
                total,
                hasMore: offset + projects.length < total
            }
        });
    }));

    app.post('/api/projects', authenticateToken, asyncHandler(async (req, res) => {
        const { name, collaborators = [] } = req.body || {};
        const projectName = typeof name === 'string' ? name.trim() : '';

        if (!projectName) {
            throw new ValidationError('Project name is required');
        }
        if (projectName.length > 250) {
            throw new ValidationError('Project name must be 250 characters or less');
        }
        if (!Array.isArray(collaborators)) {
            throw new ValidationError('Collaborators must be an array');
        }

        const normalized = [];
        const seenUserIds = new Set();
        for (const entry of collaborators) {
            const userId = Number(entry?.userId);
            const role = entry?.role;

            if (!Number.isInteger(userId) || userId <= 0) {
                throw new ValidationError('Each collaborator must include a valid userId');
            }
            if (!Object.prototype.hasOwnProperty.call(ROLE_ENUM, role)) {
                throw new ValidationError('Each collaborator must include a valid role');
            }
            if (seenUserIds.has(userId)) continue;

            const user = User.findById(userId);
            if (!user) {
                throw new ValidationError(`Collaborator user ${userId} does not exist`);
            }

            seenUserIds.add(userId);
            normalized.push({ userId, role });
        }

        const creatorId = req.user.id;
        const project = Project.create({
            name: projectName,
            creatorUserId: creatorId
        });

        // Ensure creator is always an admin collaborator.
        const withoutCreator = normalized.filter((entry) => entry.userId !== creatorId);
        Project.addCollaborator({ projectId: project.id, userId: creatorId, role: ROLE_ENUM.admin });

        for (const collaborator of withoutCreator) {
            Project.addCollaborator({
                projectId: project.id,
                userId: collaborator.userId,
                role: collaborator.role
            });
        }

        res.status(201).json({
            project: {
                id: project.id,
                name: project.name
            },
            collaboratorCount: withoutCreator.length + 1
        });
    }));

    app.get('/api/projects/:projectId', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0) {
            throw new ValidationError('Invalid project id');
        }

        const project = Project.findForUser({ projectId, userId: req.user.id });
        if (!project) {
            throw new ValidationError('Project not found or inaccessible');
        }

        const collaborators = Project.listCollaborators(projectId);
        res.json({
            project: {
                id: project.id,
                name: project.name,
                role: project.userRole,
                isCreator: project.isCreator,
                createdAt: project.createdAt
            },
            collaborators
        });
    }));

    app.put('/api/projects/:projectId/collaborators', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0) {
            throw new ValidationError('Invalid project id');
        }

        const project = Project.findForUser({ projectId, userId: req.user.id });
        if (!project) {
            throw new ValidationError('Project not found or inaccessible');
        }
        if (project.userRole !== 'admin') {
            throw new ValidationError('Only project admins can update collaborators');
        }

        const collaborators = req.body?.collaborators;
        if (!Array.isArray(collaborators)) {
            throw new ValidationError('Collaborators must be an array');
        }
        if (collaborators.length === 0) {
            throw new ValidationError('Project must include at least one collaborator');
        }

        const normalized = [];
        const seenUserIds = new Set();
        let adminCount = 0;

        for (const entry of collaborators) {
            const userId = Number(entry?.userId);
            const role = entry?.role;

            if (!Number.isInteger(userId) || userId <= 0) {
                throw new ValidationError('Each collaborator must include a valid userId');
            }
            if (!Object.prototype.hasOwnProperty.call(ROLE_ENUM, role)) {
                throw new ValidationError('Each collaborator must include a valid role');
            }
            if (seenUserIds.has(userId)) continue;

            const user = User.findById(userId);
            if (!user) {
                throw new ValidationError(`Collaborator user ${userId} does not exist`);
            }

            if (role === 'admin') {
                adminCount += 1;
            }

            seenUserIds.add(userId);
            normalized.push({ userId, role });
        }

        if (normalized.length === 0) {
            throw new ValidationError('Project must include at least one collaborator');
        }
        if (adminCount === 0) {
            throw new ValidationError('Project must include at least one admin');
        }

        Project.replaceCollaborators({ projectId, collaborators: normalized });

        res.json({
            project: {
                id: project.id,
                name: project.name
            },
            collaboratorCount: normalized.length
        });
    }));

    app.get('/api/projects/:projectId/files', authenticateToken, asyncHandler(async (req, res) => {
        const projectId = Number(req.params.projectId);
        if (!Number.isInteger(projectId) || projectId <= 0) {
            throw new ValidationError('Invalid project id');
        }

        const project = Project.findForUser({ projectId, userId: req.user.id });
        if (!project) {
            throw new ValidationError('Project not found or inaccessible');
        }

        const files = File.findByProjectId(projectId).map((file) => ({
            id: file.id,
            originalName: file.original_name,
            storedName: file.stored_name,
            size: file.file_size,
            mimeType: file.mime_type,
            uploadDate: file.upload_date,
            lastModifiedAt: file.last_modified_at || file.upload_date,
            lastViewedAt: file.last_viewed_at || null
        }));

        res.json({ files });
    }));
}
