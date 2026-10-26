import config from '../config/index.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireDirectusLink } from '../auth/requireDirectusLink.js';
import { requireDirectusUserToken } from '../auth/directusUserSession.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import {
    listVersions,
    createVersion,
    updateVersion,
    deleteVersion
} from '../services/attachmentVersions.js';
import { getCaseAttachment, updateDirectusAttachmentFile } from '../services/directus.js';
import { runPruneJob } from '../jobs/pruneVersions.js';

export default function directusVersionRoutes(app) {
    if (!config.directus.casesEnabled) return;

    const collabAuth = [authenticateToken, requireDirectusLink, requireDirectusUserToken];

    // -----------------------------------------------------------------------
    // List versions for an attachment
    // -----------------------------------------------------------------------
    app.get(
        '/api/directus/cases/:caseId/attachments/:attachmentId/versions',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { caseId, attachmentId } = req.params;
            if (!caseId || !attachmentId) throw new ValidationError(msg('case.case_attachment_ids_required'));

            const limit = Math.min(Number(req.query.limit) || 50, 200);
            const offset = Number(req.query.offset) || 0;

            const versions = await listVersions(attachmentId, {
                accessToken: req.directusAccessToken,
                limit,
                offset
            });

            res.json({ versions, meta: { caseId, attachmentId, limit, offset } });
        })
    );

    // -----------------------------------------------------------------------
    // Restore a version — creates a new version pointing at the old file,
    // updates the attachment's current file pointer. Non-destructive.
    // -----------------------------------------------------------------------
    app.post(
        '/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId/restore',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { caseId, attachmentId, versionId } = req.params;
            if (!caseId || !attachmentId || !versionId) {
                throw new ValidationError(msg('case.case_attachment_ids_required'));
            }

            // Fetch the version to restore
            const versions = await listVersions(attachmentId, {
                accessToken: req.directusAccessToken,
                limit: 200
            });
            const target = versions.find((v) => v.id === versionId);
            if (!target) throw new NotFoundError(msg('case.version_not_found'));
            if (target.archive_status === 'restoring') {
                throw new ValidationError(msg('case.version_restoring'));
            }

            // Point the attachment at the restored file
            await updateDirectusAttachmentFile(attachmentId, target.file_id, {
                accessToken: req.directusAccessToken
            });

            // Record the restore as a new version so history is never rewritten
            await createVersion(
                {
                    attachmentId,
                    caseId,
                    fileId: target.file_id,
                    userId: req.user?.id ?? null,
                    label: `Restored from ${target.date_created ? new Date(target.date_created).toLocaleDateString() : 'earlier version'}`
                },
                { accessToken: req.directusAccessToken }
            );

            const updated = await getCaseAttachment(caseId, attachmentId, {
                accessToken: req.directusAccessToken
            });
            res.json({ success: true, attachment: updated });
        })
    );

    // -----------------------------------------------------------------------
    // Update label / pin on a version
    // -----------------------------------------------------------------------
    app.patch(
        '/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { attachmentId, versionId } = req.params;
            if (!attachmentId || !versionId) throw new ValidationError(msg('case.case_attachment_ids_required'));

            const patch = {};
            if (req.body.label !== undefined) patch.label = req.body.label ?? null;
            if (req.body.is_pinned !== undefined) patch.is_pinned = Boolean(req.body.is_pinned);

            if (Object.keys(patch).length === 0) {
                throw new ValidationError(msg('case.no_update_fields'));
            }

            const updated = await updateVersion(versionId, patch, {
                accessToken: req.directusAccessToken
            });
            res.json({ version: updated?.data ?? updated });
        })
    );

    // -----------------------------------------------------------------------
    // Delete a specific version (non-pinned only)
    // -----------------------------------------------------------------------
    app.delete(
        '/api/directus/cases/:caseId/attachments/:attachmentId/versions/:versionId',
        ...collabAuth,
        asyncHandler(async (req, res) => {
            const { attachmentId, versionId } = req.params;
            if (!attachmentId || !versionId) throw new ValidationError(msg('case.case_attachment_ids_required'));

            const versions = await listVersions(attachmentId, {
                accessToken: req.directusAccessToken,
                limit: 200
            });
            const target = versions.find((v) => v.id === versionId);
            if (!target) throw new NotFoundError(msg('case.version_not_found'));
            if (target.is_pinned) throw new ValidationError(msg('case.version_pinned'));

            await deleteVersion(versionId);
            res.json({ success: true });
        })
    );

    // -----------------------------------------------------------------------
    // Admin: manually trigger prune job
    // -----------------------------------------------------------------------
    app.post(
        '/api/directus/admin/versions/prune',
        authenticateToken,
        asyncHandler(async (req, res) => {
            if (!req.user?.isAdmin) throw new ValidationError(msg('http.forbidden'), null, 'FORBIDDEN');
            const stats = await runPruneJob();
            res.json(stats);
        })
    );
}
