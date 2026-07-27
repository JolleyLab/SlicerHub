import crypto from 'crypto';
import db from '../db/database.js';

const DEFAULT_EXPIRATION_HOURS = 72;

export const SHARE_VIEWER_KINDS = Object.freeze({
    TRAME: 'trame',
    SLICER_GUI: 'slicer-gui'
});

class ShareLink {
    static create({
        fileId,
        createdByUserId,
        expiresAt = null,
        readOnly = true,
        allowedUserIds = [],
        shareMode = 'whole_file',
        viewState = null,
        viewerKind = SHARE_VIEWER_KINDS.TRAME
    }) {
        const token = crypto.randomBytes(24).toString('hex');
        const effectiveExpiresAt = expiresAt || new Date(Date.now() + DEFAULT_EXPIRATION_HOURS * 60 * 60 * 1000).toISOString();
        const normalizedAllowedUserIds = Array.isArray(allowedUserIds)
            ? [...new Set(allowedUserIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
            : [];
        const kind = viewerKind === SHARE_VIEWER_KINDS.SLICER_GUI
            ? SHARE_VIEWER_KINDS.SLICER_GUI
            : SHARE_VIEWER_KINDS.TRAME;
        const stmt = db.prepare(`
            INSERT INTO share_links (
                token, file_id, created_by_user_id, expires_at, read_only,
                allowed_user_ids, share_mode, view_state_json, viewer_kind
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            token,
            fileId,
            createdByUserId,
            effectiveExpiresAt,
            readOnly ? 1 : 0,
            JSON.stringify(normalizedAllowedUserIds),
            shareMode,
            viewState ? JSON.stringify(viewState) : null,
            kind
        );

        return {
            id: result.lastInsertRowid,
            token,
            fileId,
            createdByUserId,
            expiresAt: effectiveExpiresAt,
            readOnly: !!readOnly,
            allowedUserIds: normalizedAllowedUserIds,
            shareMode,
            viewState: viewState || null,
            viewerKind: kind
        };
    }

    static findByToken(token) {
        const stmt = db.prepare(`
            SELECT * FROM share_links
            WHERE token = ? AND revoked_at IS NULL
        `);
        return stmt.get(token);
    }

    static isExpired(shareLink) {
        if (!shareLink?.expires_at) return false;
        return new Date(shareLink.expires_at).getTime() < Date.now();
    }

    static getAllowedUserIds(shareLink) {
        if (!shareLink?.allowed_user_ids) return [];
        try {
            const parsed = JSON.parse(shareLink.allowed_user_ids);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
        } catch (_) {
            return [];
        }
    }

    static getViewState(shareLink) {
        if (!shareLink?.view_state_json) return null;
        try {
            return JSON.parse(shareLink.view_state_json);
        } catch (_) {
            return null;
        }
    }

    static getViewerKind(shareLink) {
        return shareLink?.viewer_kind === SHARE_VIEWER_KINDS.SLICER_GUI
            ? SHARE_VIEWER_KINDS.SLICER_GUI
            : SHARE_VIEWER_KINDS.TRAME;
    }
}

export default ShareLink;
