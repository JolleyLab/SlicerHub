/**
 * ============================================================================
 * CUTOVER — My Projects → Cases migrate (one release window)
 * ============================================================================
 * Delete when the cutover ends (search CUTOVER (project-case-migrate)):
 *   - this file
 *   - migration 029 tables (optional DROP in a later migration)
 *   - config.directus.projectCaseMigrateEnabled
 *   - routes + features flag + SPA button
 *   - applyPendingProjectCaseCollaborators call sites
 *
 * Per-project: admin creates a Case, uploads project files as attachments,
 * stores non-owner collaborators for deferred add on their next Directus login.
 * ============================================================================
 */

import { Readable } from 'stream';
import config from '../config/index.js';
import db from '../db/database.js';
import storage from '../storage/index.js';
import Project from '../models/Project.js';
import File from '../models/File.js';
import { findDirectusLinkForUser } from '../auth/identityStore.js';
import {
    createCase,
    uploadDirectusFile,
    createCaseAttachment,
    addCaseCollaborator,
    addCaseCollaboratorAsSystem,
    CASE_COLLAB_ROLES
} from './directus.js';
import {
    ValidationError,
    ForbiddenError,
    NotFoundError,
    ConflictError
} from '../utils/errors.js';
import { msg } from '../i18n/index.js';

const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 500 * 1024 * 1024;

export function isProjectCaseMigrateEnabled() {
    return config.directus?.projectCaseMigrateEnabled === true
        && config.directus?.casesEnabled === true;
}

function mapProjectRoleToCaseRole(role) {
    return normalizePendingRole(role);
}

function normalizePendingRole(role) {
    const raw = String(role || '').trim().toLowerCase().replace(/-/g, '_');
    if (raw === 'admin') return CASE_COLLAB_ROLES.ADMIN;
    if (raw === 'read_only' || raw === 'readonly' || raw === 'observer') {
        return CASE_COLLAB_ROLES.READ_ONLY;
    }
    return CASE_COLLAB_ROLES.COLLABORATOR;
}

async function readObjectToBuffer(key) {
    const stream = await storage.openReadStream(key);
    if (!stream) {
        throw new Error(`Missing storage object: ${key}`);
    }
    if (Buffer.isBuffer(stream)) return stream;
    if (!(stream instanceof Readable) && typeof stream?.[Symbol.asyncIterator] !== 'function') {
        throw new Error(`Unsupported storage stream for ${key}`);
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export function getProjectCaseMigration(projectId) {
    const id = Number(projectId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return db.prepare(`
        SELECT project_id, case_id, migrated_by_app_user_id, migrated_at,
               file_ok, file_failed, status, notes
        FROM project_case_migrations
        WHERE project_id = ?
    `).get(id) || null;
}

function insertMigrationRow({
    projectId,
    caseId,
    migratedByAppUserId,
    fileOk,
    fileFailed,
    notes
}) {
    db.prepare(`
        INSERT INTO project_case_migrations (
            project_id, case_id, migrated_by_app_user_id,
            file_ok, file_failed, status, notes
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?)
    `).run(
        Number(projectId),
        String(caseId),
        migratedByAppUserId != null ? Number(migratedByAppUserId) : null,
        Number(fileOk) || 0,
        Number(fileFailed) || 0,
        notes || null
    );
}

function insertPendingCollaborator({ projectId, caseId, email, role }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized.includes('@')) return;
    const existing = db.prepare(`
        SELECT id FROM project_case_pending_collaborators
        WHERE case_id = ? AND invitee_email = ? AND status = 'pending'
        LIMIT 1
    `).get(String(caseId), normalized);
    if (existing) return;
    db.prepare(`
        INSERT INTO project_case_pending_collaborators (
            project_id, case_id, invitee_email, proposed_role, status
        ) VALUES (?, ?, ?, ?, 'pending')
    `).run(
        Number(projectId),
        String(caseId),
        normalized,
        normalizePendingRole(role)
    );
}

function markPendingApplied(rowId, directusUserId) {
    db.prepare(`
        UPDATE project_case_pending_collaborators
        SET status = 'applied',
            applied_at = CURRENT_TIMESTAMP,
            applied_directus_user_id = ?
        WHERE id = ?
    `).run(String(directusUserId), Number(rowId));
}

/**
 * After Directus login/link: add this user to any Cases pending from project migrate.
 */
export async function applyPendingProjectCaseCollaborators({
    appUserId,
    directusUserId,
    email
} = {}) {
    if (!isProjectCaseMigrateEnabled()) return { applied: 0 };

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const dxId = String(directusUserId || '').trim();
    if (!normalizedEmail.includes('@') || !dxId) return { applied: 0 };

    const pending = db.prepare(`
        SELECT id, case_id, proposed_role
        FROM project_case_pending_collaborators
        WHERE invitee_email = ? AND status = 'pending'
        ORDER BY id ASC
    `).all(normalizedEmail);

    let applied = 0;
    for (const row of pending) {
        try {
            await addCaseCollaboratorAsSystem(
                row.case_id,
                dxId,
                row.proposed_role || CASE_COLLAB_ROLES.COLLABORATOR
            );
            markPendingApplied(row.id, dxId);
            applied += 1;
        } catch (err) {
            console.warn(
                'CUTOVER project-case-migrate: pending collaborator apply failed',
                normalizedEmail,
                row.case_id,
                err.message || err
            );
        }
    }

    if (applied > 0) {
        console.info(
            `CUTOVER project-case-migrate: applied ${applied} pending case role(s) for ${normalizedEmail}`
            + (appUserId != null ? ` (appUser=${appUserId})` : '')
        );
    }
    return { applied };
}

/**
 * Migrate one My Project → Case (files + deferred collaborators).
 * @param {{
 *   projectId: number,
 *   appUserId: number,
 *   accessToken: string,
 *   actorDirectusUserId: string,
 *   onProgress?: (evt: object) => void
 * }} args
 */
export async function migrateProjectToCase({
    projectId,
    appUserId,
    accessToken,
    actorDirectusUserId,
    onProgress
}) {
    const emit = (evt) => {
        try {
            onProgress?.(evt);
        } catch (err) {
            console.warn('CUTOVER project-case-migrate: onProgress failed', err?.message || err);
        }
    };
    if (!isProjectCaseMigrateEnabled()) {
        throw new ForbiddenError(
            msg('project.migrate_to_case_disabled'),
            'PROJECT_CASE_MIGRATE_DISABLED',
            'project.migrate_to_case_disabled'
        );
    }
    if (!accessToken) {
        throw new ValidationError(msg('directus.session_incomplete'), null, 'directus.session_incomplete');
    }

    const pid = Number(projectId);
    const project = Project.findForUser({ projectId: pid, userId: appUserId });
    if (!project) {
        throw new NotFoundError(msg('project.not_found'), null, 'project.not_found');
    }
    if (project.userRole !== 'admin') {
        throw new ForbiddenError(
            msg('project.migrate_admin_only'),
            null,
            'project.migrate_admin_only'
        );
    }

    const existing = getProjectCaseMigration(pid);
    if (existing?.case_id) {
        throw new ConflictError(
            msg('project.already_migrated_to_case'),
            'PROJECT_ALREADY_MIGRATED',
            'project.already_migrated_to_case'
        );
    }

    const files = File.findByProjectId(pid) || [];
    const totalFiles = files.length;
    emit({ phase: 'case', done: 0, total: totalFiles });

    const caseRow = await createCase(
        {
            title: project.name,
            description: `Migrated from My Project #${pid}`
        },
        { accessToken }
    );
    const caseId = String(caseRow.id);
    emit({ phase: 'case_ready', caseId, done: 0, total: totalFiles });

    const fileResults = [];
    let fileOk = 0;
    let fileFailed = 0;

    for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const displayName = String(file.display_title || file.original_name || 'file').trim()
            || file.original_name
            || 'file';
        emit({
            phase: 'file',
            done: i,
            total: totalFiles,
            current: displayName,
            ok: fileOk,
            failed: fileFailed,
            caseId
        });
        try {
            const size = Number(file.file_size) || 0;
            if (size > MAX_UPLOAD_BYTES) {
                throw new Error(`File exceeds upload limit (${MAX_UPLOAD_BYTES} bytes)`);
            }
            const key = storage.normalizeKey(file.file_path);
            if (!(await storage.exists(key))) {
                throw new Error('File missing from storage');
            }
            const buffer = await readObjectToBuffer(key);
            const directusFile = await uploadDirectusFile({
                buffer,
                originalname: file.original_name || displayName,
                mimetype: file.mime_type || 'application/octet-stream'
            }, { accessToken });
            const attachment = await createCaseAttachment(
                caseId,
                directusFile.id,
                displayName,
                { accessToken, fileMeta: directusFile }
            );
            fileOk += 1;
            fileResults.push({
                fileId: file.id,
                status: 'ok',
                attachmentId: attachment?.id || null,
                directusFileId: directusFile.id
            });
        } catch (err) {
            fileFailed += 1;
            fileResults.push({
                fileId: file.id,
                status: 'error',
                name: displayName,
                error: String(err.message || err)
            });
        }
        emit({
            phase: 'file',
            done: i + 1,
            total: totalFiles,
            current: displayName,
            ok: fileOk,
            failed: fileFailed,
            caseId
        });
    }

    emit({
        phase: 'collaborators',
        done: totalFiles,
        total: totalFiles,
        ok: fileOk,
        failed: fileFailed,
        caseId
    });

    const collaborators = Project.listCollaborators(pid) || [];
    const collabResults = [];
    for (const entry of collaborators) {
        const email = String(entry.user?.email || '').trim().toLowerCase();
        const userId = entry.user?.id;
        if (!email.includes('@')) {
            collabResults.push({ userId, status: 'skipped', reason: 'no_email' });
            continue;
        }
        // Skip the migrating admin — they own the case via user_created.
        if (Number(userId) === Number(appUserId)) {
            collabResults.push({ userId, email, status: 'owner_skip' });
            continue;
        }

        const caseRole = mapProjectRoleToCaseRole(entry.role);
        insertPendingCollaborator({
            projectId: pid,
            caseId,
            email,
            role: caseRole
        });

        const link = findDirectusLinkForUser(userId);
        if (link?.external_id) {
            try {
                await addCaseCollaborator(caseId, link.external_id, caseRole, {
                    accessToken,
                    actorDirectusUserId
                });
                const pending = db.prepare(`
                    SELECT id FROM project_case_pending_collaborators
                    WHERE case_id = ? AND invitee_email = ? AND status = 'pending'
                    LIMIT 1
                `).get(caseId, email);
                if (pending) markPendingApplied(pending.id, link.external_id);
                collabResults.push({
                    userId,
                    email,
                    status: 'added',
                    role: caseRole
                });
            } catch (err) {
                collabResults.push({
                    userId,
                    email,
                    status: 'pending',
                    role: caseRole,
                    note: String(err.message || err)
                });
            }
        } else {
            collabResults.push({
                userId,
                email,
                status: 'pending',
                role: caseRole
            });
        }
    }

    const notes = fileFailed
        ? `${fileFailed} file(s) failed to upload`
        : null;
    insertMigrationRow({
        projectId: pid,
        caseId,
        migratedByAppUserId: appUserId,
        fileOk,
        fileFailed,
        notes
    });

    return {
        projectId: pid,
        caseId,
        title: caseRow.title || project.name,
        files: {
            total: files.length,
            ok: fileOk,
            failed: fileFailed,
            results: fileResults
        },
        collaborators: collabResults
    };
}
