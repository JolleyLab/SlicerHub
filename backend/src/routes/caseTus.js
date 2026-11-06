/**
 * TUS resumable-upload endpoint for case attachments.
 *
 * Mount path:  /api/cases/:caseId/files/tus
 *
 * Upload lifecycle:
 *   1. Browser POSTs to create an upload — TUS server assigns an upload ID.
 *   2. Browser PATCHes chunks until complete.
 *   3. On completion, onUploadFinish creates a Payload `attachments` record.
 *      storage_key = caseFiles/{uploadId}  (where FileStore actually wrote it)
 *
 * Storage backend swap:
 *   @tus/file-store → replace with a custom DataStore that wraps
 *   AzureBlobStore or S3Store when moving to cloud. No route-level changes.
 */

import path from 'path';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { assertCaseAccess } from '../utils/caseAccess.js';

// FileStore writes files flat under this directory as {uploadId}.
// The storage key is caseFiles/{uploadId} — matches CASE_KEY_PREFIX in contract.js.
const CASE_FILES_DIR = path.resolve('caseFiles');

/**
 * Registers the TUS upload route on the Express app.
 * Called from the main app setup after Payload is initialised.
 *
 * @param {import('express').Application} app
 * @param {import('payload').Payload} payload
 */
export function registerCaseTusRoute(app, payload) {
    const datastore = new FileStore({ directory: CASE_FILES_DIR });
    const tusServer = new TusServer({
        // path is required but overridden by generateUrl below.
        path: '/api/cases',
        relativeLocation: true,
        datastore,
        // A finished upload is a case attachment; it is removed through the
        // attachments API (case admin only), never by a TUS DELETE.
        disableTerminationForFinishedUploads: true,

        // Build Location: /api/cases/{caseId}/files/tus/{uploadId}
        // req here is srvx's NodeRequest; original Express req is at req.runtime.node.req.
        generateUrl(req, { id }) {
            const expressReq = req.runtime?.node?.req ?? req;
            const caseId = expressReq.params?.caseId ?? 'unknown';
            return `/api/cases/${encodeURIComponent(caseId)}/files/tus/${encodeURIComponent(id)}`;
        },

        // Auth and case access are enforced by the Express middleware on the routes below.
        // onIncomingRequest is NOT used here because @tus/server wraps Express's req in a
        // srvx NodeRequest before calling hooks — req.user from Express is not present on it.

        /**
         * Stamp the case and uploader into the upload's metadata (overwriting anything
         * the client sent) so later PATCH/HEAD/DELETE requests can be tied back to them.
         */
        async onUploadCreate(req, upload) {
            const expressReq = req.runtime?.node?.req ?? req;
            return {
                metadata: {
                    ...(upload.metadata ?? {}),
                    caseId: String(expressReq.params?.caseId ?? ''),
                    uploaderSub: String(expressReq.tusUploaderSub ?? ''),
                },
            };
        },

        /**
         * Called once the upload is 100% complete.
         * Creates the Payload attachment record; the file is already on disk.
         *
         * req here is srvx's NodeRequest wrapper; original Express req is at req.runtime.node.req.
         */
        async onUploadFinish(req, upload) {
            const expressReq = req.runtime?.node?.req ?? req;
            const caseId = expressReq.params?.caseId;
            // The upload guard below resolved the uploader's Keycloak id (tusUploaderSub).
            const userId = expressReq.tusUploaderSub
                || expressReq.user?.keycloakSub
                || null;
            const meta   = upload.metadata ?? {};

            // Metadata values are already base64-decoded by @tus/utils — no extra decode needed.
            const originalFilename = meta.filename || upload.id;
            const mimeType = meta.filetype || 'application/octet-stream';

            if (!userId) {
                console.error('[TUS] onUploadFinish: uploader has no Keycloak identity — attachment not created', { caseId, uploadId: upload.id });
                throw new Error('[TUS] uploader has no Keycloak identity — cannot create attachment record');
            }

            // FileStore writes to CASE_FILES_DIR/{uploadId} — key is caseFiles/{uploadId}
            const storageKey = `caseFiles/${upload.id}`;

            try {
                await payload.create({
                    collection: 'attachments',
                    data: {
                        case:              parseInt(caseId, 10),
                        storage_key:       storageKey,
                        original_filename: originalFilename,
                        mime_type:         mimeType,
                        size_bytes:        upload.size ?? null,
                        uploaded_by:       userId,
                    },
                });
            } catch (err) {
                console.error('[TUS] onUploadFinish failed:', {
                    caseId,
                    userId,
                    storageKey,
                    uploadId: upload.id,
                    error: err?.message,
                    details: JSON.stringify(err?.data || err?.errors || ''),
                });
                throw err;
            }
        },
    });

    /**
     * Uploading needs collaborator access to the case in the URL. An existing upload
     * can only be resumed, inspected or cancelled by the person who started it, on the
     * case it was started on. GET is refused: @tus/server would otherwise serve the
     * file bytes, bypassing the attachment download permission check.
     */
    async function requireCaseUploadAccess(req, res, next) {
        try {
            const method = req.method.toUpperCase();
            if (method === 'OPTIONS') return next();
            if (method === 'GET') {
                return res.status(405).json({ error: { message: 'Method not allowed' } });
            }

            const caseId = String(req.params.caseId || '');
            if (!/^\d+$/.test(caseId)) {
                return res.status(404).json({ error: { message: 'Case not found' } });
            }
            const caseDoc = await payload.findByID({ collection: 'cases', id: caseId, depth: 0 })
                .catch(() => null);
            if (!caseDoc) {
                return res.status(404).json({ error: { message: 'Case not found' } });
            }
            await assertCaseAccess(caseDoc, req, 'collaborator');

            const uploaderSub = req.user?.keycloakSub;
            if (!uploaderSub) {
                return res.status(403).json({ error: { message: 'A Keycloak identity is required to upload' } });
            }
            req.tusUploaderSub = uploaderSub;

            if (req.params.uploadId) {
                const upload = await datastore.getUpload(req.params.uploadId).catch(() => null);
                const meta = upload?.metadata ?? {};
                if (!upload || meta.caseId !== caseId || meta.uploaderSub !== uploaderSub) {
                    return res.status(404).json({ error: { message: 'Upload not found' } });
                }
            }
            next();
        } catch (err) {
            next(err);
        }
    }

    // All TUS methods under /api/cases/:caseId/files/tus[/:uploadId]
    app.all(
        '/api/cases/:caseId/files/tus',
        authenticateToken,
        requireCaseUploadAccess,
        (req, res) => tusServer.handle(req, res),
    );
    app.all(
        '/api/cases/:caseId/files/tus/:uploadId',
        authenticateToken,
        requireCaseUploadAccess,
        (req, res) => tusServer.handle(req, res),
    );
}
