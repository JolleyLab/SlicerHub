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
    const tusServer = new TusServer({
        // path is required but overridden by generateUrl below.
        path: '/api/cases',
        relativeLocation: true,
        datastore: new FileStore({ directory: CASE_FILES_DIR }),

        // Build Location: /api/cases/{caseId}/files/tus/{uploadId}
        // req here is srvx's NodeRequest; original Express req is at req.runtime.node.req.
        generateUrl(req, { id }) {
            const expressReq = req.runtime?.node?.req ?? req;
            const caseId = expressReq.params?.caseId ?? 'unknown';
            return `/api/cases/${encodeURIComponent(caseId)}/files/tus/${encodeURIComponent(id)}`;
        },

        // Auth is enforced by the authenticateToken Express middleware on the route below.
        // onIncomingRequest is NOT used here because @tus/server wraps Express's req in a
        // srvx NodeRequest before calling hooks — req.user from Express is not present on it.

        /**
         * Called once the upload is 100% complete.
         * Creates the Payload attachment record; the file is already on disk.
         *
         * req here is srvx's NodeRequest wrapper; original Express req is at req.runtime.node.req.
         */
        async onUploadFinish(req, upload) {
            const expressReq = req.runtime?.node?.req ?? req;
            const caseId = expressReq.params?.caseId;
            const userId = expressReq.user?.id;
            const meta   = upload.metadata ?? {};

            // Metadata values are already base64-decoded by @tus/utils — no extra decode needed.
            const originalFilename = meta.filename || upload.id;
            const mimeType = meta.filetype || 'application/octet-stream';

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

    // All TUS methods under /api/cases/:caseId/files/tus[/:uploadId]
    app.all(
        '/api/cases/:caseId/files/tus',
        authenticateToken,
        (req, res) => tusServer.handle(req, res),
    );
    app.all(
        '/api/cases/:caseId/files/tus/:uploadId',
        authenticateToken,
        (req, res) => tusServer.handle(req, res),
    );
}
