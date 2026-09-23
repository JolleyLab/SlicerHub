import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../config/index.js';
import { AppError, ForbiddenError, InternalError, NotFoundError, ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import {
    applyCaseCollaboratorRoleOverrides,
    getCaseCollaboratorRoleOverride,
    setCaseCollaboratorRoleOverride
} from './caseCollaboratorRoles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Thin Directus REST client.
 * - Service ops (provision): config.directus.token
 * - Cases / collab: per-request accessToken ("call as user") — never fall back to service token
 * Never expose tokens to the browser.
 */
export function isDirectusConfigured() {
    // URL + service token (system jobs / provision / legacy)
    return Boolean(config.directus.url && config.directus.token);
}

/** Cases BFF only needs the Directus base URL; user bears API auth. */
export function isDirectusUrlConfigured() {
    return Boolean(config.directus.url);
}

export class DirectusUnavailableError extends AppError {
    constructor(message = 'Directus is not configured') {
        super(message, 503);
    }
}

const CASE_CORE_FIELDS_BASE = [
    'id',
    'title',
    'description',
    'status',
    'user_created.id',
    'user_created.email',
    'user_created.first_name',
    'user_created.last_name'
];

/**
 * Case list field sets (first success wins).
 *
 * Prefer `*` so accountability dates (`date_created` / `date_updated`) are
 * included whenever the role may read them — without naming them (naming a
 * forbidden field 403s the whole request and used to force a no-date fallback).
 * Custom Timestamp fields (`created_at` / `updated_at`) are covered by `*` too.
 */
const CASE_FIELDS_ATTEMPTS = Object.freeze([
    ['*', 'user_created.id', 'user_created.email', 'user_created.first_name', 'user_created.last_name'].join(','),
    [...CASE_CORE_FIELDS_BASE, 'date_created', 'date_updated'].join(','),
    CASE_CORE_FIELDS_BASE.join(',')
]);

const CASE_CORE_FIELDS = CASE_FIELDS_ATTEMPTS[0];

/** Nested file fields — fetched separately so broken attachment ACL cannot hide cases. */
const ATTACHMENT_CORE_FIELDS = [
    'id',
    'name',
    'case',
    'file.id',
    'file.filename_download',
    'file.type',
    'file.filesize',
    'file.created_on',
    'file.uploaded_on',
    'file.modified_on'
];

/** Prefer accountability dates; fall back when the role cannot read them. */
const ATTACHMENT_FIELDS_ATTEMPTS = Object.freeze([
    [...ATTACHMENT_CORE_FIELDS.slice(0, 3), 'date_created', 'date_updated', ...ATTACHMENT_CORE_FIELDS.slice(3)].join(','),
    ATTACHMENT_CORE_FIELDS.join(','),
    // Narrower: omit file accountability dates if those are blocked too.
    [
        'id',
        'name',
        'case',
        'file.id',
        'file.filename_download',
        'file.type',
        'file.filesize'
    ].join(',')
]);

const ATTACHMENT_LIST_FIELDS = ATTACHMENT_FIELDS_ATTEMPTS[0];

const COLLABORATOR_CASE_FIELDS_WITH_ROLE = [
    'id',
    'collaborators.id',
    'collaborators.role',
    'collaborators.directus_users_id.id',
    'collaborators.directus_users_id.email',
    'collaborators.directus_users_id.first_name',
    'collaborators.directus_users_id.last_name'
].join(',');

/** Clinician policies often deny junction `role` (or the field is not created yet). */
const COLLABORATOR_CASE_FIELDS_NO_ROLE = [
    'id',
    'collaborators.id',
    'collaborators.directus_users_id.id',
    'collaborators.directus_users_id.email',
    'collaborators.directus_users_id.first_name',
    'collaborators.directus_users_id.last_name'
].join(',');

const COLLABORATOR_CASE_FIELDS_MIN = [
    'id',
    'collaborators.id',
    'collaborators.directus_users_id'
].join(',');

const COLLABORATOR_CASE_FIELDS_ATTEMPTS = Object.freeze([
    COLLABORATOR_CASE_FIELDS_WITH_ROLE,
    COLLABORATOR_CASE_FIELDS_NO_ROLE,
    COLLABORATOR_CASE_FIELDS_MIN,
    'id,collaborators'
]);

/** @deprecated use COLLABORATOR_CASE_FIELDS_ATTEMPTS */
const COLLABORATOR_CASE_FIELDS = COLLABORATOR_CASE_FIELDS_NO_ROLE;

function isMissingRoleFieldError(err) {
    const message = String(err?.message || err || '');
    return /field ["']?role["']?.*case_directus_users|case_directus_users.*field ["']?role["']?|Queried in ["']?collaborators["']?/i.test(message)
        && /role/i.test(message);
}

function isJunctionCollectionDeniedError(err) {
    const message = String(err?.message || err || '');
    return /case_directus_users/i.test(message)
        && /permission to access collection|does not exist|forbidden/i.test(message);
}

function isCaseCollectionDeniedError(err) {
    const message = String(err?.message || err || '');
    // Root /items/case denied (common for locked-down DIRECTUS_TOKEN roles).
    return /permission to access collection ["']?case["']?|collection ["']?case["']?.*does not exist/i.test(message)
        && !/case_directus_users/i.test(message);
}

/**
 * PATCH role on one junction row. Resolves id via case+user when needed.
 * Tries several dropdown value spellings (admin|collaborator|readonly|read_only).
 */
async function patchOneCollaboratorRole(caseKey, { userId, junctionId, role }, { accessToken } = {}) {
    const opts = accessToken ? { accessToken } : {};
    let id = junctionId ? String(junctionId) : '';

    const resolveId = async () => {
        if (id) {
            try {
                const got = await directusFetch(
                    `/items/case_directus_users/${encodeURIComponent(id)}`,
                    { ...opts, query: { fields: 'id,role,directus_users_id' } }
                );
                if (got?.data?.id != null) return String(got.data.id);
            } catch (_) {
                id = '';
            }
        }
        const map = await loadCaseJunctionByUserId(caseKey, { accessToken });
        const row = userId ? map.get(String(userId)) : null;
        if (row?.junctionId) return String(row.junctionId);
        return '';
    };

    id = await resolveId();
    if (!id) {
        throw new AppError(
            `Could not resolve case_directus_users row for user ${userId || '?'}.`,
            404,
            'CASE_COLLABORATOR_JUNCTION_NOT_FOUND'
        );
    }

    const desired = toDirectusCaseCollabRole(role);
    const candidates = [...new Set([
        desired,
        String(role || '').trim(),
        normalizeCaseCollabRole(role),
        desired === 'readonly' ? 'read_only' : null,
        desired === 'read_only' ? 'readonly' : null,
        'collaborator',
        'admin',
        'readonly'
    ].filter(Boolean))];

    // Prefer the intended value first; keep others as fallbacks for dropdown mismatches.
    const ordered = [desired, ...candidates.filter((c) => c !== desired)];

    let lastErr = null;
    for (const value of ordered) {
        try {
            await directusFetch(`/items/case_directus_users/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                ...opts,
                body: { role: value }
            });
            setCaseCollaboratorRoleOverride(caseKey, userId, normalizeCaseCollabRole(value));
            return { junctionId: id, role: value };
        } catch (err) {
            lastErr = err;
            const msg = String(err?.message || '');
            // Pure auth denials still allow app-managed role (membership stays on junction).
            if (/permission|forbidden|access collection|access field/i.test(msg)
                && !/unexpected|INTERNAL_SERVER_ERROR/i.test(msg)) {
                const appRole = normalizeCaseCollabRole(role);
                setCaseCollaboratorRoleOverride(caseKey, userId, appRole);
                console.warn(
                    'Directus denied case_directus_users.role write; using app role override',
                    { caseId: caseKey, userId, role: appRole, directus: msg }
                );
                return { junctionId: id, role: appRole, viaOverride: true };
            }
        }
    }

    // Directus role column often 500s (bad dropdown / INTERNAL_SERVER_ERROR). Membership
    // stays on the junction; app role is stored in SQLite product runtime.
    const appRole = normalizeCaseCollabRole(role);
    setCaseCollaboratorRoleOverride(caseKey, userId, appRole);
    console.warn(
        'Directus case_directus_users.role write failed; using app role override',
        {
            caseId: caseKey,
            userId,
            role: appRole,
            directus: lastErr?.message || null,
            code: lastErr?.directusExtensions?.code || null
        }
    );
    return { junctionId: id, role: appRole, viaOverride: true };
}

async function patchCollaboratorRolesViaJunction(caseKey, updates, { accessToken } = {}) {
    for (const row of updates || []) {
        await patchOneCollaboratorRole(caseKey, row, { accessToken });
    }
}

/**
 * Probe whether DIRECTUS_TOKEN can touch the junction collection at all.
 * Nested case.collaborators writes still require this permission in Directus.
 */
async function probeServiceJunctionAccess() {
    if (!config.directus.token) {
        return { ok: false, message: 'DIRECTUS_TOKEN is not configured on the BFF' };
    }
    try {
        await directusFetch('/items/case_directus_users', {
            query: { limit: '1', fields: 'id' }
        });
        return { ok: true, message: null };
    } catch (err) {
        return { ok: false, message: String(err?.message || err) };
    }
}

/** Case membership roles (junction `role` field). Owner is always admin via user_created. */
export const CASE_COLLAB_ROLES = Object.freeze({
    ADMIN: 'admin',
    COLLABORATOR: 'collaborator',
    READ_ONLY: 'read_only'
});

function directusCacheDir() {
    const configured = (config.directus.cacheDir || '').trim();
    if (configured) return configured;
    // Prefer host-bind path under slicer-gui so cache survives and copies stay on one volume.
    return path.join(process.cwd(), 'data', 'slicer-gui', 'directus-cache');
}

function ensureCacheDir() {
    const dir = directusCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function sanitizeFileName(name) {
    const base = path.basename(String(name || 'attachment').trim() || 'attachment');
    return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'attachment';
}

function pickTimestamp(...candidates) {
    for (const value of candidates) {
        if (value == null || value === '') continue;
        const date = value instanceof Date ? value : new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return null;
}

/** Common Slicer-loadable extensions (scenes, volumes, models). */
const SLICER_OPEN_EXTENSIONS = Object.freeze([
    '.mrb',
    '.mrml',
    '.nrrd',
    '.nhdr',
    '.nii',
    '.nii.gz',
    '.mgz',
    '.mha',
    '.mhd',
    '.dcm',
    '.dicom',
    '.img',
    '.hdr',
    '.stl',
    '.obj',
    '.ply',
    '.vtk',
    '.vtp',
    '.vtu',
    '.fcsv',
    '.seg.nrrd'
]);

const BROWSER_PREVIEW_EXTENSIONS = Object.freeze([
    '.pdf',
    '.txt',
    '.csv',
    '.json',
    '.md',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp'
]);

const BROWSER_PREVIEW_MIME_PREFIXES = Object.freeze([
    'text/',
    'image/',
    'application/pdf',
    'application/json'
]);

function attachmentFileName(filename, fallbackName) {
    return String(filename || fallbackName || '').trim().toLowerCase();
}

function detectIsMrb(filename, mimeType) {
    const lowerName = attachmentFileName(filename);
    return lowerName.endsWith('.mrb')
        || mimeType === 'application/x-mrb'
        || mimeType === 'application/vnd.slicer.mrb';
}

function detectCanOpenInSlicer(filename, mimeType) {
    if (detectIsMrb(filename, mimeType)) return true;
    const lowerName = attachmentFileName(filename);
    if (!lowerName) return false;
    if (SLICER_OPEN_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
    const mime = String(mimeType || '').toLowerCase();
    return mime === 'application/dicom'
        || mime === 'application/x-nrrd'
        || mime === 'application/sla'
        || mime === 'model/stl'
        || mime === 'model/obj'
        || mime === 'model/mesh';
}

function detectCanPreviewInBrowser(filename, mimeType) {
    if (detectCanOpenInSlicer(filename, mimeType)) return false;
    const lowerName = attachmentFileName(filename);
    if (BROWSER_PREVIEW_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
    const mime = String(mimeType || '').toLowerCase();
    return BROWSER_PREVIEW_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function attachmentOpenFlags(filename, mimeType) {
    const isMrb = detectIsMrb(filename, mimeType);
    const canOpenInSlicer = detectCanOpenInSlicer(filename, mimeType);
    const canPreviewInBrowser = detectCanPreviewInBrowser(filename, mimeType);
    return { isMrb, canOpenInSlicer, canPreviewInBrowser };
}

function mapAttachment(row) {
    const file = row?.file && typeof row.file === 'object' ? row.file : null;
    const fileId = file?.id ?? (typeof row?.file === 'string' ? row.file : null);
    const filenameDownload = file?.filename_download || null;
    const mimeType = file?.type || null;
    const filesizeRaw = file?.filesize;
    const filesize = filesizeRaw != null && filesizeRaw !== ''
        ? Number(filesizeRaw)
        : null;
    const modifiedAt = pickTimestamp(
        file?.modified_on,
        file?.uploaded_on,
        file?.created_on,
        row?.date_updated,
        row?.date_created
    );
    const openFlags = attachmentOpenFlags(filenameDownload || row?.name, mimeType);

    return {
        id: row?.id ?? null,
        name: row?.name ?? null,
        fileId,
        filenameDownload,
        mimeType,
        filesize: Number.isFinite(filesize) ? filesize : null,
        modifiedAt,
        ...openFlags
    };
}

const USER_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MENTION_UUID_RE = new RegExp(`@(${USER_UUID_RE.source})`, 'gi');

function formatPersonName(user) {
    if (!user || typeof user !== 'object') return null;
    const first = (user.first_name || '').trim();
    const last = (user.last_name || '').trim();
    const name = `${first} ${last}`.trim();
    return name || user.email || null;
}

function extractMentionUserIds(text) {
    const ids = new Set();
    const re = new RegExp(MENTION_UUID_RE.source, 'gi');
    let match;
    while ((match = re.exec(String(text || ''))) !== null) {
        ids.add(match[1].toLowerCase());
    }
    return [...ids];
}

/**
 * Resolve Directus @<user-uuid> mentions (often wrapped in NBSP) to "@First Last".
 * Assumes the service token can read first/last names for mentioned users.
 */
function resolveCommentText(text, usersById = {}) {
    return String(text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\u0001/g, '')
        .replace(MENTION_UUID_RE, (_, id) => {
            const user = usersById[String(id).toLowerCase()];
            const name = formatPersonName(user);
            return name ? `@${name}` : `@${id}`;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

function mapCommentAuthor(user) {
    if (!user) return null;
    if (typeof user === 'string') {
        return { id: user, name: 'Unknown', email: null };
    }
    if (typeof user !== 'object') return null;
    return {
        id: user.id ?? null,
        name: formatPersonName(user) || 'Unknown',
        email: user.email || null
    };
}

function mapComment(row, usersById = {}) {
    const caseId = row?.item != null ? String(row.item) : null;
    return {
        id: row?.id ?? null,
        caseId,
        body: resolveCommentText(row?.comment, usersById),
        createdAt: row?.date_created ?? null,
        updatedAt: row?.date_updated ?? null,
        author: mapCommentAuthor(row?.user_created)
    };
}

/**
 * Batch-load Directus users by id for mention resolution.
 * @returns {Promise<Record<string, object>>} keyed by lowercase user id
 */
async function fetchUsersByIds(userIds, { accessToken } = {}) {
    const unique = [...new Set((userIds || []).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))];
    if (!unique.length) return {};

    const payload = await directusFetch('/users', {
        accessToken,
        query: {
            'filter[id][_in]': unique.join(','),
            fields: 'id,first_name,last_name,email',
            limit: String(Math.min(100, unique.length))
        }
    });

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const byId = {};
    for (const row of rows) {
        if (!row?.id) continue;
        byId[String(row.id).toLowerCase()] = row;
    }
    return byId;
}

function mapDirectusPerson(user) {
    if (!user?.id) return null;
    const name = formatPersonName(user);
    const email = user.email || null;
    return {
        id: String(user.id),
        email,
        username: name || (email ? email.split('@')[0] : null),
        firstName: user.first_name || null,
        lastName: user.last_name || null
    };
}

function normalizeCaseCollabRole(role) {
    const raw = String(role || '').trim().toLowerCase().replace(/-/g, '_');
    if (raw === CASE_COLLAB_ROLES.ADMIN) return CASE_COLLAB_ROLES.ADMIN;
    if (
        raw === CASE_COLLAB_ROLES.READ_ONLY
        || raw === 'readonly'
        || raw === 'observer'
        || raw === 'read'
    ) {
        return CASE_COLLAB_ROLES.READ_ONLY;
    }
    return CASE_COLLAB_ROLES.COLLABORATOR;
}

/** Values written to Directus dropdown `case_directus_users.role` (choices: admin|collaborator|readonly). */
function toDirectusCaseCollabRole(role) {
    const normalized = normalizeCaseCollabRole(role);
    if (normalized === CASE_COLLAB_ROLES.READ_ONLY) return 'readonly';
    return normalized;
}

/**
 * Load junction rows via nested `case.collaborators` (no root access to case_directus_users).
 * @returns {Promise<Map<string, { junctionId: string, role: string }>>}
 */
async function loadCaseJunctionViaNestedCase(caseKey, { accessToken } = {}) {
    const caseId = String(caseKey || '').trim();
    const out = new Map();
    if (!caseId) return out;

    const fieldAttempts = [
        'id,collaborators.id,collaborators.role,collaborators.directus_users_id.id,collaborators.directus_users_id',
        'id,collaborators.id,collaborators.role,collaborators.directus_users_id',
        'id,collaborators.id,collaborators.directus_users_id',
        'id,collaborators'
    ];
    const tokens = [];
    if (accessToken) tokens.push(accessToken);
    if (config.directus.token) tokens.push(undefined);

    for (const token of tokens) {
        for (const fields of fieldAttempts) {
            try {
                const payload = await directusFetch(`/items/case/${encodeURIComponent(caseId)}`, {
                    ...(token ? { accessToken: token } : {}),
                    query: { fields }
                });
                const rows = Array.isArray(payload?.data?.collaborators)
                    ? payload.data.collaborators
                    : [];
                for (const row of rows) {
                    const userRef = row?.directus_users_id;
                    const userId = userRef && typeof userRef === 'object'
                        ? String(userRef.id || '')
                        : String(userRef || (row?.id && row?.email ? row.id : '') || '');
                    // When collaborators expand to users only, row.id is user id — not usable for update.
                    const hasUserRef = row?.directus_users_id != null;
                    const junctionId = hasUserRef && row?.id != null ? String(row.id) : '';
                    if (!userId || !junctionId) continue;
                    out.set(String(userId), {
                        junctionId,
                        role: normalizeCaseCollabRole(row?.role)
                    });
                }
                if (out.size) return out;
            } catch (_) {
                /* try next fields/token */
            }
        }
    }
    return out;
}

/**
 * Load case_directus_users rows keyed by Directus user id.
 * Tries nested case.collaborators first (no root junction permission needed),
 * then root `/items/case_directus_users` when allowed.
 * @returns {Promise<Map<string, { junctionId: string, role: string }>>}
 */
async function loadCaseJunctionByUserId(caseKey, { accessToken } = {}) {
    const nested = await loadCaseJunctionViaNestedCase(caseKey, { accessToken });
    if (nested.size) return nested;

    const caseId = String(caseKey || '').trim();
    const out = new Map();
    if (!caseId) return out;

    const tokens = [];
    if (config.directus.token) tokens.push(undefined);
    if (accessToken) tokens.push(accessToken);

    for (const token of tokens) {
        for (const caseField of ['case_id', 'case']) {
            try {
                const payload = await directusFetch('/items/case_directus_users', {
                    ...(token ? { accessToken: token } : {}),
                    query: {
                        [`filter[${caseField}][_eq]`]: caseId,
                        fields: `id,role,directus_users_id,${caseField}`,
                        limit: '200'
                    }
                });
                const rows = Array.isArray(payload?.data) ? payload.data : [];
                if (!rows.length) continue;
                for (const row of rows) {
                    const userRef = row?.directus_users_id;
                    const userId = userRef && typeof userRef === 'object'
                        ? String(userRef.id || '')
                        : String(userRef || '');
                    const junctionId = row?.id != null ? String(row.id) : '';
                    if (!userId || !junctionId) continue;
                    out.set(userId, {
                        junctionId,
                        role: normalizeCaseCollabRole(row?.role)
                    });
                }
                if (out.size) return out;
            } catch (err) {
                // Root junction collection often denied for clinicians — nested path is preferred.
                if (/permission to access collection|does not exist|forbidden/i.test(String(err?.message || ''))) {
                    return out;
                }
                if (isMissingRoleFieldError(err)) {
                    try {
                        const payload = await directusFetch('/items/case_directus_users', {
                            ...(token ? { accessToken: token } : {}),
                            query: {
                                [`filter[${caseField}][_eq]`]: caseId,
                                fields: `id,directus_users_id,${caseField}`,
                                limit: '200'
                            }
                        });
                        const rows = Array.isArray(payload?.data) ? payload.data : [];
                        for (const row of rows) {
                            const userRef = row?.directus_users_id;
                            const userId = userRef && typeof userRef === 'object'
                                ? String(userRef.id || '')
                                : String(userRef || '');
                            const junctionId = row?.id != null ? String(row.id) : '';
                            if (!userId || !junctionId) continue;
                            out.set(userId, {
                                junctionId,
                                role: CASE_COLLAB_ROLES.COLLABORATOR
                            });
                        }
                        if (out.size) return out;
                    } catch (_) {
                        /* try next */
                    }
                }
            }
        }
        if (out.size) return out;
    }
    return out;
}

/**
 * Ensure case owner appears on collaborators with role=admin.
 * Prefers nested case PATCH. Soft-fails unless required.
 * @param {{ accessToken?: string, required?: boolean }} options
 */
async function ensureCaseOwnerJunctionAdmin(caseKey, ownerId, { accessToken, required = false } = {}) {
    const caseId = String(caseKey || '').trim();
    const uid = String(ownerId || '').trim();
    if (!caseId || !uid) return false;

    const byUser = await loadCaseJunctionByUserId(caseId, { accessToken });
    const existing = byUser.get(uid);
    if (existing?.junctionId && existing.role === CASE_COLLAB_ROLES.ADMIN) {
        return true;
    }

    // Service token first — owner backfill is BFF glue after migration.
    const tokens = [];
    if (config.directus.token) tokens.push(undefined);
    if (accessToken) tokens.push(accessToken);
    if (!tokens.length) tokens.push(undefined);

    const errors = [];
    const adminRole = toDirectusCaseCollabRole(CASE_COLLAB_ROLES.ADMIN);

    const tryNested = async (token, body) => {
        await directusFetch(`/items/case/${encodeURIComponent(caseId)}`, {
            method: 'PATCH',
            ...(token ? { accessToken: token } : {}),
            body
        });
    };

    // Already on junction but wrong/default role → promote to admin.
    // If promote fails, still succeed: presence is what People updates need.
    if (existing?.junctionId) {
        for (const token of tokens) {
            try {
                await tryNested(token, {
                    collaborators: {
                        update: [{ id: existing.junctionId, role: adminRole }]
                    }
                });
                return true;
            } catch (err) {
                errors.push(err);
            }
            try {
                await directusFetch(
                    `/items/case_directus_users/${encodeURIComponent(existing.junctionId)}`,
                    {
                        method: 'PATCH',
                        ...(token ? { accessToken: token } : {}),
                        body: { role: adminRole }
                    }
                );
                return true;
            } catch (err) {
                errors.push(err);
            }
        }
        console.warn(
            'Owner is on case_directus_users but role could not be set to admin:',
            errors[0]?.message || errors[0]
        );
        return true;
    }

    // Not on junction — try several create shapes (Directus M2M + dropdown quirks).
    const nestedCreateBodies = [
        { collaborators: { create: [{ directus_users_id: uid, role: adminRole }] } },
        { collaborators: { create: [{ directus_users_id: uid }] } },
        { collaborators: { create: [uid] } },
        { collaborators: { create: [{ directus_users_id: { id: uid }, role: adminRole }] } }
    ];

    for (const token of tokens) {
        for (const body of nestedCreateBodies) {
            try {
                await tryNested(token, body);
            } catch (err) {
                errors.push(err);
            }
            // Create may 500 on duplicate while the row already exists (manual add).
            const refreshed = await loadCaseJunctionByUserId(caseId, { accessToken });
            const row = refreshed.get(uid);
            if (row?.junctionId) {
                if (row.role !== CASE_COLLAB_ROLES.ADMIN) {
                    try {
                        await tryNested(token, {
                            collaborators: {
                                update: [{ id: row.junctionId, role: adminRole }]
                            }
                        });
                    } catch (_) {
                        /* presence is enough */
                    }
                }
                return true;
            }
        }

        for (const caseField of ['case_id', 'case']) {
            for (const extra of [
                { directus_users_id: uid, role: adminRole },
                { directus_users_id: uid }
            ]) {
                try {
                    await directusFetch('/items/case_directus_users', {
                        method: 'POST',
                        ...(token ? { accessToken: token } : {}),
                        body: { [caseField]: caseId, ...extra }
                    });
                } catch (err) {
                    errors.push(err);
                }
                const again = await loadCaseJunctionByUserId(caseId, { accessToken });
                if (again.get(uid)?.junctionId) return true;
            }
        }
    }

    const finalCheck = await loadCaseJunctionByUserId(caseId, { accessToken });
    if (finalCheck.get(uid)?.junctionId) return true;

    if (required) {
        throw ownerBackfillError(errors);
    }
    console.warn(
        'ensureCaseOwnerJunctionAdmin: owner still not visible on junction',
        { caseId, ownerId: uid, lastError: errors[0]?.message || null }
    );
    return false;
}

function ownerBackfillError(errors) {
    const parts = [];
    for (const err of errors || []) {
        const msg = String(err?.message || err || '').trim();
        if (!msg) continue;
        if (!parts.includes(msg)) parts.push(msg);
        const ext = err?.directusExtensions;
        if (ext?.code && !parts.includes(String(ext.code))) parts.push(String(ext.code));
        if (ext?.field && !parts.includes(`field=${ext.field}`)) parts.push(`field=${ext.field}`);
    }
    const detail = parts.slice(0, 3).join(' | ');
    return new AppError(
        'Case owner is missing from collaborators (post-migration). Could not add them as admin. '
        + 'In Directus Content → case_directus_users, add the owner (Created By) with role=admin, '
        + 'or grant DIRECTUS_TOKEN Create/Update on that collection. '
        + 'Dropdown choices must include exactly: admin, collaborator, readonly. '
        + (detail ? `Directus: ${detail}` : ''),
        403,
        'CASE_OWNER_JUNCTION_MISSING'
    );
}

function extractCollaboratorUser(entry) {
    if (!entry) return null;
    if (entry.directus_users_id && typeof entry.directus_users_id === 'object') {
        return entry.directus_users_id;
    }
    if (typeof entry.directus_users_id === 'string') {
        return { id: entry.directus_users_id };
    }
    // M2M sometimes returns related users directly (no junction metadata)
    if (entry.id && (entry.email || entry.first_name || entry.last_name) && entry.directus_users_id == null) {
        return entry;
    }
    if (typeof entry === 'string') {
        return { id: entry };
    }
    return null;
}

function mapCollaboratorsFromCaseRow(row) {
    const raw = Array.isArray(row?.collaborators) ? row.collaborators : [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
        const person = mapDirectusPerson(extractCollaboratorUser(entry));
        if (!person?.id || seen.has(person.id)) continue;
        seen.add(person.id);
        out.push({
            ...person,
            role: normalizeCaseCollabRole(entry?.role),
            junctionId: entry?.id != null && entry?.directus_users_id != null
                ? String(entry.id)
                : null
        });
    }
    return out;
}

function mapCase(
    row,
    commentsByCaseId = {},
    attachmentsByCaseId = {},
    collaboratorsByCaseId = {},
    activityByCaseId = {}
) {
    const caseId = row?.id != null ? String(row.id) : null;
    const fromRow = Array.isArray(row?.attachments)
        ? row.attachments.map(mapAttachment).filter((a) => a.id)
        : null;
    const fromIndex = caseId && Array.isArray(attachmentsByCaseId[caseId])
        ? attachmentsByCaseId[caseId]
        : null;
    const attachments = fromIndex || fromRow || [];
    const comments = caseId && Array.isArray(commentsByCaseId[caseId])
        ? commentsByCaseId[caseId]
        : [];
    const collaborators = caseId && Array.isArray(collaboratorsByCaseId[caseId])
        ? collaboratorsByCaseId[caseId]
        : mapCollaboratorsFromCaseRow(row);
    const createdBy = mapDirectusPerson(
        row?.user_created && typeof row.user_created === 'object'
            ? row.user_created
            : (row?.user_created ? { id: row.user_created } : null)
    );
    const activity = (caseId && activityByCaseId[caseId]) || {};
    // Prefer item accountability/app date fields when present; otherwise Activity
    // (Studio Revisions). `case` often has no date_created column.
    const createdAt = pickTimestamp(row?.date_created, row?.created_at, activity.createdAt);
    const updatedAt = pickTimestamp(
        row?.date_updated,
        row?.updated_at,
        activity.updatedAt,
        createdAt
    );
    return {
        id: caseId,
        title: row?.title ?? null,
        description: row?.description ?? null,
        status: row?.status ?? null,
        createdAt,
        updatedAt,
        createdBy,
        collaborators,
        attachments,
        comments
    };
}

/**
 * Load create/update timestamps from Directus Activity (Studio Revisions).
 * Cases themselves are always listed call-as-user. Activity is a system
 * collection clinicians often cannot Read — if the user token fails, enrich
 * timestamps with the service token for those same case ids only (never used
 * to discover or list cases).
 * @returns {Promise<Record<string, { createdAt: string|null, updatedAt: string|null }>>}
 */
async function listCaseActivityTimestampsByCaseIds(caseIds, { accessToken } = {}) {
    const ids = [...new Set((caseIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return {};

    const idSet = new Set(ids);
    const query = {
        'filter[collection][_eq]': 'case',
        'filter[action][_in]': 'create,update',
        fields: 'id,action,item,timestamp',
        limit: String(Math.min(500, Math.max(100, ids.length * 8))),
        sort: 'timestamp'
    };
    if (ids.length <= 80) {
        query['filter[item][_in]'] = ids.join(',');
    }

    function foldRows(rows) {
        const byCase = {};
        for (const row of rows || []) {
            const key = row?.item != null ? String(row.item) : '';
            if (!key || !idSet.has(key)) continue;
            const ts = pickTimestamp(row?.timestamp);
            if (!ts) continue;
            if (!byCase[key]) {
                byCase[key] = { createdAt: null, updatedAt: null };
            }
            const action = String(row?.action || '').toLowerCase();
            if (action === 'create') {
                if (!byCase[key].createdAt || ts < byCase[key].createdAt) {
                    byCase[key].createdAt = ts;
                }
            }
            if (!byCase[key].updatedAt || ts > byCase[key].updatedAt) {
                byCase[key].updatedAt = ts;
            }
        }
        for (const key of Object.keys(byCase)) {
            if (!byCase[key].createdAt) byCase[key].createdAt = byCase[key].updatedAt;
            if (!byCase[key].updatedAt) byCase[key].updatedAt = byCase[key].createdAt;
        }
        return byCase;
    }

    async function fetchActivity(token) {
        const payload = await directusFetch('/activity', {
            ...(token ? { accessToken: token } : {}),
            query
        });
        return foldRows(Array.isArray(payload?.data) ? payload.data : []);
    }

    // 1) Prefer call-as-user when the role can read Activity.
    if (accessToken) {
        try {
            const asUser = await fetchActivity(accessToken);
            const missing = ids.filter((id) => !asUser[id]?.createdAt && !asUser[id]?.updatedAt);
            if (!missing.length) return asUser;

            // 2) Fill gaps with service token for already-visible case ids only.
            try {
                const asService = await fetchActivity(undefined);
                for (const id of missing) {
                    if (asService[id]) asUser[id] = asService[id];
                }
                return asUser;
            } catch (svcErr) {
                console.warn(
                    'Directus activity timestamp service enrichment failed:',
                    svcErr.message || svcErr
                );
                return asUser;
            }
        } catch (err) {
            // Clinician policies usually deny directus_activity entirely.
            console.warn(
                'Directus activity as-user denied; enriching timestamps via service token '
                + 'for already-listed cases only:',
                err.message || err
            );
        }
    }

    try {
        return await fetchActivity(undefined);
    } catch (err) {
        console.warn(
            'Directus activity timestamps unavailable (case cards may lack Created dates):',
            err.message || err
        );
        return {};
    }
}

/**
 * Load collaborators for case ids (separate from case list so ACL quirks don't hide cases).
 */
async function listCollaboratorsByCaseIds(caseIds, { accessToken } = {}) {
    const ids = [...new Set((caseIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length || !accessToken) return {};

    let lastErr = null;
    for (const fields of COLLABORATOR_CASE_FIELDS_ATTEMPTS) {
        try {
            const payload = await directusFetch('/items/case', {
                accessToken,
                query: {
                    'filter[id][_in]': ids.join(','),
                    fields,
                    limit: String(ids.length)
                }
            });
            const rows = Array.isArray(payload?.data) ? payload.data : [];
            const byCase = {};
            for (const row of rows) {
                const key = row?.id != null ? String(row.id) : '';
                if (!key) continue;
                byCase[key] = mapCollaboratorsFromCaseRow(row);
            }
            // When user token cannot read junction `role`, fill from service for these ids only.
            const enriched = await enrichCollaboratorRolesFromJunction(byCase, ids);
            for (const caseId of Object.keys(enriched)) {
                enriched[caseId] = applyCaseCollaboratorRoleOverrides(caseId, enriched[caseId]);
            }
            return enriched;
        } catch (err) {
            lastErr = err;
            if (!isMissingRoleFieldError(err) && !/permission|forbidden|access field/i.test(String(err?.message || ''))) {
                break;
            }
        }
    }

    console.warn('Directus collaborators fetch failed (cases still listed):', lastErr?.message || lastErr);
    return {};
}

/**
 * Fill junction `role` via service token for case ids the user can already see.
 * No-op when the role column is missing in Directus.
 */
async function enrichCollaboratorRolesFromJunction(byCase, caseIds) {
    const ids = (caseIds || []).map((id) => String(id)).filter(Boolean);
    if (!ids.length || !byCase || typeof byCase !== 'object') return byCase || {};

    let rows = [];
    for (const caseField of ['case_id', 'case']) {
        try {
            const payload = await directusFetch('/items/case_directus_users', {
                query: {
                    [`filter[${caseField}][_in]`]: ids.join(','),
                    fields: `id,role,directus_users_id,${caseField}`,
                    limit: String(Math.min(500, Math.max(50, ids.length * 20)))
                }
            });
            rows = Array.isArray(payload?.data) ? payload.data : [];
            if (rows.length) break;
        } catch (err) {
            if (isMissingRoleFieldError(err)) {
                // Role column not in schema / not readable even as service — leave defaults.
                return byCase;
            }
            // try alternate case field name
        }
    }
    if (!rows.length) return byCase;

    for (const row of rows) {
        const caseRef = row?.case_id ?? row?.case;
        const caseKey = caseRef && typeof caseRef === 'object'
            ? String(caseRef.id || '')
            : String(caseRef || '');
        if (!caseKey || !byCase[caseKey]) continue;

        const userRef = row?.directus_users_id;
        const userId = userRef && typeof userRef === 'object'
            ? String(userRef.id || '')
            : String(userRef || '');
        if (!userId) continue;

        const list = byCase[caseKey];
        const idx = list.findIndex((m) => String(m.id) === userId);
        const role = normalizeCaseCollabRole(row?.role);
        const junctionId = row?.id != null ? String(row.id) : null;
        if (idx >= 0) {
            list[idx] = {
                ...list[idx],
                role,
                junctionId: junctionId || list[idx].junctionId
            };
        } else {
            list.push({
                id: userId,
                email: null,
                username: null,
                firstName: null,
                lastName: null,
                role,
                junctionId
            });
        }
    }
    return byCase;
}

/**
 * Load attachments for the given case ids.
 * Failures return {} so case list still works when attachment/file policies are mid-edit.
 */
async function listAttachmentsByCaseIds(caseIds, { accessToken } = {}) {
    const ids = [...new Set((caseIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length || !accessToken) return {};

    const fieldAttempts = ATTACHMENT_FIELDS_ATTEMPTS;

    let lastErr = null;
    for (const fields of fieldAttempts) {
        try {
            const payload = await directusFetch('/items/attachment', {
                accessToken,
                query: {
                    'filter[case][_in]': ids.join(','),
                    fields,
                    limit: String(Math.min(500, Math.max(50, ids.length * 20)))
                }
            });
            const rows = Array.isArray(payload?.data) ? payload.data : [];
            const byCase = {};
            for (const row of rows) {
                const caseRef = row?.case;
                const caseId = caseRef && typeof caseRef === 'object'
                    ? caseRef.id
                    : caseRef;
                const key = caseId != null ? String(caseId) : '';
                if (!key) continue;
                const mapped = mapAttachment(row);
                if (!mapped.id) continue;
                if (!byCase[key]) byCase[key] = [];
                byCase[key].push(mapped);
            }
            return enrichAttachmentsFromFiles(byCase, { accessToken });
        } catch (err) {
            lastErr = err;
        }
    }

    console.warn('Directus attachments fetch failed (cases still listed):', lastErr?.message || lastErr);
    return {};
}

/**
 * Fill missing original filename / size / dates from /files when the nested
 * attachment→file read omits those fields (common with field-level permissions).
 */
async function enrichAttachmentsFromFiles(byCase, { accessToken } = {}) {
    if (!accessToken || !byCase || typeof byCase !== 'object') return byCase || {};

    const attachments = Object.values(byCase).flat();
    const fileIds = [...new Set(
        attachments
            .filter((a) => a?.fileId && (!a.modifiedAt || !a.filenameDownload || a.filesize == null))
            .map((a) => String(a.fileId))
    )];
    if (!fileIds.length) return byCase;

    try {
        const payload = await directusFetch('/files', {
            accessToken,
            query: {
                'filter[id][_in]': fileIds.join(','),
                fields: 'id,filename_download,type,filesize,created_on,uploaded_on,modified_on',
                limit: String(Math.min(500, fileIds.length))
            }
        });
        const files = Array.isArray(payload?.data) ? payload.data : [];
        const byFileId = new Map(files.filter((f) => f?.id).map((f) => [String(f.id), f]));
        if (!byFileId.size) return byCase;

        for (const [caseId, list] of Object.entries(byCase)) {
            byCase[caseId] = list.map((attachment) => {
                const file = byFileId.get(String(attachment.fileId));
                if (!file) return attachment;
                const filenameDownload = attachment.filenameDownload || file.filename_download || null;
                const filesizeRaw = attachment.filesize != null ? attachment.filesize : file.filesize;
                const filesize = filesizeRaw != null && filesizeRaw !== ''
                    ? Number(filesizeRaw)
                    : null;
                const mimeType = attachment.mimeType || file.type || null;
                const filenameForFlags = filenameDownload || attachment.name;
                return {
                    ...attachment,
                    filenameDownload,
                    mimeType,
                    filesize: Number.isFinite(filesize) ? filesize : null,
                    modifiedAt: attachment.modifiedAt || pickTimestamp(
                        file.modified_on,
                        file.uploaded_on,
                        file.created_on
                    ),
                    ...attachmentOpenFlags(filenameForFlags, mimeType)
                };
            });
        }
    } catch (err) {
        console.warn('Directus file meta enrich failed:', err.message || err);
    }

    return byCase;
}

/**
 * @param {string} pathName - Path under the Directus host, e.g. "/items/case"
 * @param {{ method?: string, query?: Record<string, string>, body?: unknown, accessToken?: string }} [options]
 * accessToken: when set, call as that user. When omitted, use service DIRECTUS_TOKEN.
 */
export async function directusFetch(pathName, { method = 'GET', query, body, accessToken } = {}) {
    if (!config.directus.url) {
        throw new DirectusUnavailableError('Directus is not configured. Set DIRECTUS_URL.');
    }

    const bearer = accessToken
        ? String(accessToken)
        : (config.directus.token || '');

    if (!bearer) {
        throw new DirectusUnavailableError(
            accessToken === undefined
                ? 'Directus service token is not configured. Set DIRECTUS_TOKEN for system operations.'
                : 'Directus user access token is required'
        );
    }

    const url = new URL(pathName.startsWith('/') ? pathName : `/${pathName}`, `${config.directus.url}/`);
    if (query && typeof query === 'object') {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        }
    }

    let response;
    try {
        response = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${bearer}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
    } catch (err) {
        throw new InternalError(`Directus request failed: ${err.message || 'network error'}`);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const first = payload?.errors?.[0];
        const message = first?.message
            || first?.extensions?.reason
            || first?.extensions?.code
            || payload?.message
            || `Directus returned ${response.status}`;
        const extensions = first?.extensions && typeof first.extensions === 'object'
            ? first.extensions
            : null;
        const detailBits = [message];
        if (extensions?.code && !detailBits.includes(String(extensions.code))) {
            detailBits.push(String(extensions.code));
        }
        if (extensions?.field) detailBits.push(`field=${extensions.field}`);
        if (extensions?.collection) detailBits.push(`collection=${extensions.collection}`);
        if (typeof extensions?.message === 'string' && extensions.message !== message) {
            detailBits.push(extensions.message);
        }
        const richMessage = detailBits.filter(Boolean).join(' | ');
        if (accessToken && (response.status === 401 || response.status === 403)) {
            const err = new AppError(richMessage, response.status, response.status === 401
                ? 'DIRECTUS_USER_UNAUTHORIZED'
                : 'DIRECTUS_USER_FORBIDDEN');
            if (extensions) err.directusExtensions = extensions;
            throw err;
        }
        const status = response.status >= 400 && response.status < 600 ? response.status : 502;
        const err = new AppError(richMessage, status === 401 || status === 403 ? 502 : status);
        if (extensions) err.directusExtensions = extensions;
        if (Array.isArray(payload?.errors) && payload.errors.length > 1) {
            err.directusErrors = payload.errors.map((e) => e?.message).filter(Boolean);
        }
        throw err;
    }

    return payload;
}

/**
 * Look up a Directus user by email (service token).
 * @returns {Promise<{ id: string, email: string, status?: string, role?: string } | null>}
 */
export async function findDirectusUserByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;

    const payload = await directusFetch('/users', {
        query: {
            'filter[email][_eq]': normalized,
            fields: 'id,email,status,role,first_name,last_name',
            limit: '1'
        }
    });

    const row = Array.isArray(payload?.data) ? payload.data[0] : null;
    return row || null;
}

/**
 * Load a Directus user profile by id (service token).
 * Used for display-name enrichment when clinician field ACL hides names on /users/me.
 */
export async function findDirectusUserById(directusUserId) {
    const id = String(directusUserId || '').trim();
    if (!id) return null;
    try {
        const payload = await directusFetch(`/users/${encodeURIComponent(id)}`, {
            query: { fields: 'id,email,first_name,last_name,status' }
        });
        return payload?.data || null;
    } catch (err) {
        console.warn('findDirectusUserById failed:', err.message || err);
        return null;
    }
}

/**
 * Create a Directus user with the service token (active, password set).
 * @param {{ email: string, password: string, roleId: string, firstName?: string, lastName?: string }} input
 */
export async function createDirectusUser({ email, password, roleId, firstName, lastName }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
        throw new ValidationError(msg('auth.email_required'), null, 'auth.email_required');
    }
    if (!password || String(password).length < 8) {
        throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
    }
    const role = String(roleId || '').trim();
    if (!role) {
        throw new ValidationError(msg('directus.role_id_required'), null, 'directus.role_id_required');
    }

    const body = {
        email: normalized,
        password: String(password),
        role,
        status: 'active'
    };
    if (firstName) body.first_name = String(firstName).trim();
    if (lastName) body.last_name = String(lastName).trim();

    const payload = await directusFetch('/users', { method: 'POST', body });
    const user = payload?.data;
    if (!user?.id) {
        throw new InternalError('Directus user create returned no id');
    }
    return user;
}

/**
 * Update a Directus user's password (service token).
 */
export async function updateDirectusUserPassword(directusUserId, newPassword) {
    return updateDirectusUser(directusUserId, { password: newPassword });
}

/**
 * Patch Directus user fields via service token (password, first_name, last_name, …).
 * @param {string} directusUserId
 * @param {{ password?: string, firstName?: string, lastName?: string }} fields
 */
export async function updateDirectusUser(directusUserId, fields = {}) {
    const id = String(directusUserId || '').trim();
    if (!id) {
        throw new ValidationError(msg('directus.user_id_required'), null, 'directus.user_id_required');
    }

    const body = {};
    if (fields.password != null) {
        if (!fields.password || String(fields.password).length < 8) {
            throw new ValidationError(msg('auth.password_min_length_short', { min: 8 }), null, 'auth.password_min_length_short');
        }
        body.password = String(fields.password);
    }
    if (fields.firstName != null) {
        const first = String(fields.firstName || '').trim();
        if (!first) {
            throw new ValidationError(msg('auth.first_name_required'), null, 'auth.first_name_required');
        }
        body.first_name = first;
    }
    if (fields.lastName != null) {
        const last = String(fields.lastName || '').trim();
        if (!last) {
            throw new ValidationError(msg('auth.last_name_required'), null, 'auth.last_name_required');
        }
        body.last_name = last;
    }
    if (Object.keys(body).length === 0) {
        throw new ValidationError(msg('auth.profile_update_empty'), null, 'auth.profile_update_empty');
    }

    const payload = await directusFetch(`/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body
    });
    return payload?.data || null;
}

const COMMENT_FIELDS_ATTEMPTS = Object.freeze([
    [
        'id',
        'collection',
        'item',
        'comment',
        'date_created',
        'date_updated',
        'user_created.id',
        'user_created.first_name',
        'user_created.last_name',
        'user_created.email'
    ].join(','),
    [
        'id',
        'collection',
        'item',
        'comment',
        'date_created',
        'user_created.id',
        'user_created.first_name',
        'user_created.last_name',
        'user_created.email'
    ].join(','),
    [
        'id',
        'collection',
        'item',
        'comment',
        'user_created.id',
        'user_created.first_name',
        'user_created.last_name',
        'user_created.email'
    ].join(','),
    'id,collection,item,comment,user_created'
]);

/**
 * List Directus activity comments for the `case` collection (one request),
 * resolving @user-uuid mentions to first/last names.
 * @returns {Promise<Record<string, Array>>} comments keyed by case id
 */
export async function listCaseCommentsByCaseId({ limit = 200, accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.comments_token_required'), null, 'directus.comments_token_required');
    }
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));

    // Clinician policies often omit accountability date fields; fall back so
    // comments still load (same pattern as attachment field attempts).
    // Final `null` lets Directus return whatever the role may read.
    const fieldAttempts = [...COMMENT_FIELDS_ATTEMPTS, null];

    let rows = [];
    let lastErr = null;
    for (const fields of fieldAttempts) {
        try {
            const query = {
                'filter[collection][_eq]': 'case',
                limit: String(safeLimit)
            };
            if (fields) {
                query.fields = fields;
                query.sort = fields.includes('date_created') ? 'date_created' : 'id';
            } else {
                query.sort = 'id';
            }
            const payload = await directusFetch('/comments', {
                accessToken,
                query
            });
            rows = Array.isArray(payload?.data) ? payload.data : [];
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
        }
    }
    if (lastErr) {
        throw lastErr;
    }

    const mentionIds = [];
    for (const row of rows) {
        mentionIds.push(...extractMentionUserIds(row?.comment));
    }

    let usersById = {};
    try {
        usersById = await fetchUsersByIds(mentionIds, { accessToken });
    } catch (err) {
        console.warn('Directus mention user lookup failed:', err.message || err);
    }

    const byCase = {};
    for (const row of rows) {
        const mapped = mapComment(row, usersById);
        if (!mapped.caseId || !mapped.id) continue;
        if (!byCase[mapped.caseId]) byCase[mapped.caseId] = [];
        byCase[mapped.caseId].push(mapped);
    }
    return byCase;
}

/**
 * Create a Directus activity comment on a case (as the logged-in user).
 * @param {string} caseId
 * @param {string} commentText
 * @param {{ accessToken: string }} options
 * @returns {Promise<object>} mapped comment
 */
export async function createCaseComment(caseId, commentText, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.post_comment_token_required'), null, 'directus.post_comment_token_required');
    }
    const caseKey = String(caseId || '').trim();
    const body = String(commentText || '').trim();
    if (!caseKey) {
        throw new ValidationError(msg('case.case_id_required'), null, 'case.case_id_required');
    }
    if (!body) {
        throw new ValidationError(msg('case.comment_text_required'), null, 'case.comment_text_required');
    }
    if (body.length > 5000) {
        throw new ValidationError(msg('case.comment_too_long'), null, 'case.comment_too_long');
    }

    // Ensure the case exists / is readable before writing.
    await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
        accessToken,
        query: { fields: 'id' }
    });

    const created = await directusFetch('/comments', {
        method: 'POST',
        accessToken,
        body: {
            collection: 'case',
            item: caseKey,
            comment: body
        }
    });

    const createdId = created?.data?.id;
    let row = created?.data;
    if (createdId) {
        let refreshed = null;
        for (const fields of COMMENT_FIELDS_ATTEMPTS) {
            try {
                refreshed = await directusFetch(`/comments/${encodeURIComponent(createdId)}`, {
                    accessToken,
                    query: { fields }
                });
                if (refreshed?.data) {
                    row = refreshed.data;
                    break;
                }
            } catch (err) {
                console.warn('Directus comment re-fetch after create failed:', err.message || err);
            }
        }
    }

    const mentionIds = extractMentionUserIds(row?.comment);
    let usersById = {};
    try {
        usersById = await fetchUsersByIds(mentionIds, { accessToken });
    } catch (err) {
        console.warn('Directus mention user lookup failed:', err.message || err);
    }

    const mapped = mapComment(row, usersById);
    if (!mapped.id) {
        throw new InternalError('Directus did not return a created comment');
    }
    return mapped;
}

/**
 * List cases from the coworker sandbox collection (`case`, singular),
 * including attachments and Directus activity comments.
 * Must pass the signed-in user's Directus access token (call-as-user).
 *
 * Cases are loaded without nested attachments so a broken/incomplete
 * attachment or files policy cannot hide cases the user should still see.
 * @returns {Promise<{ cases: object[], commentsMeta: { loaded: boolean, error: string|null, count: number } }>}
 */
export async function listCases({ limit = 50, accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.list_cases_token_required'), null, 'directus.list_cases_token_required');
    }
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    let commentsError = null;
    const commentsPromise = listCaseCommentsByCaseId({ accessToken }).catch((err) => {
        commentsError = err?.message || String(err);
        console.warn('Directus comments fetch failed:', commentsError);
        return null;
    });

    let payload = null;
    let lastCaseErr = null;
    for (const fields of CASE_FIELDS_ATTEMPTS) {
        try {
            payload = await directusFetch('/items/case', {
                accessToken,
                query: {
                    limit: String(safeLimit),
                    fields
                }
            });
            lastCaseErr = null;
            break;
        } catch (err) {
            lastCaseErr = err;
        }
    }
    if (lastCaseErr) {
        throw lastCaseErr;
    }

    const commentsResult = await commentsPromise;
    const commentsByCaseId = commentsResult || {};
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const caseIds = rows.map((row) => row?.id).filter(Boolean).map((id) => String(id));
    const [attachmentsByCaseId, collaboratorsByCaseId, activityByCaseId] = await Promise.all([
        listAttachmentsByCaseIds(caseIds, { accessToken }),
        listCollaboratorsByCaseIds(caseIds, { accessToken }),
        listCaseActivityTimestampsByCaseIds(caseIds, { accessToken })
    ]);
    const cases = rows.map((row) => mapCase(
        row,
        commentsByCaseId,
        attachmentsByCaseId,
        collaboratorsByCaseId,
        activityByCaseId
    ));

    // Backfill owners onto case_directus_users as admin (existing cases / default=collaborator).
    const ownerBackfill = cases.filter((c) => {
        const ownerId = c.createdBy?.id ? String(c.createdBy.id) : '';
        if (!ownerId || !c.id) return false;
        const member = (c.collaborators || []).find((m) => String(m.id) === ownerId);
        return !member || normalizeCaseCollabRole(member.role) !== CASE_COLLAB_ROLES.ADMIN;
    });
    if (ownerBackfill.length) {
        const results = await Promise.allSettled(
            ownerBackfill.map((c) => ensureCaseOwnerJunctionAdmin(c.id, c.createdBy.id, { accessToken }))
        );
        const refreshedIds = ownerBackfill
            .filter((_, i) => results[i]?.status === 'fulfilled' && results[i].value)
            .map((c) => String(c.id));
        if (refreshedIds.length) {
            const refreshed = await listCollaboratorsByCaseIds(refreshedIds, { accessToken });
            for (const c of cases) {
                const key = String(c.id);
                if (Array.isArray(refreshed[key])) {
                    c.collaborators = refreshed[key];
                }
            }
        }
    }

    if (cases.length && cases.every((c) => !c.createdAt && !c.updatedAt)) {
        console.warn(
            'Directus cases listed without createdAt/updatedAt — grant the Directus '
            + 'service token role Read on Activity (`directus_activity`), or enable '
            + 'Date Created on the `case` collection in Data Model.'
        );
    }
    const attachmentTotal = cases.reduce((n, c) => n + (c.attachments?.length || 0), 0);
    const commentCount = cases.reduce((n, c) => n + (c.comments?.length || 0), 0);
    if (caseIds.length && attachmentTotal === 0) {
        console.warn(
            'Directus cases listed but 0 attachments loaded — check clinician Read on '
            + '`attachment` and `directus_files` (and that filter[case] matches accessible cases).'
        );
    }
    if (caseIds.length && commentsResult === null) {
        console.warn(
            'Directus comments unavailable — check clinician Read on Comments '
            + '(`directus_comments`) including fields used by the Cases UI.'
        );
    }
    return {
        cases,
        commentsMeta: {
            loaded: commentsResult !== null,
            error: commentsError,
            count: commentCount
        }
    };
}

/**
 * Who the access token represents (for Cases meta / debugging session mismatches).
 */
export async function fetchDirectusViewer(accessToken) {
    if (!accessToken) return null;
    try {
        const payload = await directusFetch('/users/me', {
            accessToken,
            query: {
                fields: 'id,email,first_name,last_name,role.id,role.name,role.admin_access'
            }
        });
        const u = payload?.data;
        if (!u?.id) return null;
        return {
            id: u.id,
            email: u.email || null,
            firstName: u.first_name || null,
            lastName: u.last_name || null,
            name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || null,
            roleId: u.role?.id || (typeof u.role === 'string' ? u.role : null),
            roleName: u.role?.name || null,
            adminAccess: u.role?.admin_access === true
        };
    } catch (err) {
        console.warn('Directus /users/me failed:', err.message || err);
        return null;
    }
}

/**
 * Fetch one attachment row with field fallbacks (dates often blocked for clinicians).
 */
async function fetchAttachmentRow(attachmentKey, { accessToken } = {}) {
    let lastErr = null;
    for (const fields of ATTACHMENT_FIELDS_ATTEMPTS) {
        try {
            const payload = await directusFetch(`/items/attachment/${encodeURIComponent(attachmentKey)}`, {
                accessToken,
                query: { fields }
            });
            if (payload?.data?.id) return payload.data;
        } catch (err) {
            lastErr = err;
        }
    }
    if (lastErr) throw lastErr;
    return null;
}

/**
 * Fetch one attachment and verify it belongs to the given case.
 */
export async function getCaseAttachment(caseId, attachmentId, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.attachments_token_required'), null, 'directus.attachments_token_required');
    }
    const caseKey = String(caseId || '').trim();
    const attachmentKey = String(attachmentId || '').trim();
    if (!caseKey || !attachmentKey) {
        throw new ValidationError(msg('case.case_attachment_ids_required'), null, 'case.case_attachment_ids_required');
    }

    const row = await fetchAttachmentRow(attachmentKey, { accessToken });
    if (!row?.id) {
        throw new NotFoundError(msg('case.attachment_not_found'), null, 'case.attachment_not_found');
    }

    const owningCase = typeof row.case === 'object' ? row.case?.id : row.case;
    if (String(owningCase) !== caseKey) {
        throw new NotFoundError(msg('case.attachment_not_on_case'), null, 'case.attachment_not_on_case');
    }

    const mapped = mapAttachment(row);
    if (!mapped.fileId) {
        throw new ValidationError(msg('case.attachment_no_directus_file'), null, 'case.attachment_no_directus_file');
    }
    return mapped;
}

/**
 * Ensure a Directus asset is cached on disk. Reuses the file when size matches.
 * Download uses the caller's Directus access token (no service-token fallback).
 * @returns {Promise<{ cachePath: string, fileName: string, bytes: number, reused: boolean }>}
 */
export async function ensureDirectusAssetCached({
    fileId,
    filenameDownload = null,
    expectedSize = null,
    accessToken = null
} = {}) {
    const assetId = String(fileId || '').trim();
    if (!assetId) {
        throw new ValidationError(msg('directus.file_id_required'), null, 'directus.file_id_required');
    }
    if (!accessToken) {
        throw new ValidationError(msg('directus.asset_download_token_required'), null, 'directus.asset_download_token_required');
    }
    if (!isDirectusUrlConfigured()) {
        throw new DirectusUnavailableError('Directus is not configured. Set DIRECTUS_URL.');
    }

    const safeName = sanitizeFileName(filenameDownload || `${assetId}.bin`);
    const cachePath = path.join(ensureCacheDir(), `${assetId}-${safeName}`);
    const expected = expectedSize != null && Number.isFinite(Number(expectedSize))
        ? Number(expectedSize)
        : null;

    const legacyCachePath = path.join(
        process.cwd(),
        'data',
        'directus-cache',
        `${assetId}-${safeName}`
    );

    function usableCache(candidate) {
        if (!candidate || !fs.existsSync(candidate)) return null;
        const stat = fs.statSync(candidate);
        if (expected != null && stat.size !== expected) return null;
        return { path: candidate, bytes: stat.size };
    }

    const existing = usableCache(cachePath) || usableCache(legacyCachePath);
    if (existing) {
        if (existing.path !== cachePath) {
            try {
                ensureCacheDir();
                fs.copyFileSync(existing.path, cachePath);
                console.log('Migrated Directus asset cache to slicer-gui volume', {
                    fileId: assetId,
                    bytes: existing.bytes
                });
            } catch (err) {
                console.warn('Could not migrate Directus cache; using legacy path', err.message);
                return {
                    cachePath: existing.path,
                    fileName: safeName,
                    bytes: existing.bytes,
                    reused: true
                };
            }
        }
        console.log('Reusing Directus asset cache', { fileId: assetId, bytes: existing.bytes });
        return {
            cachePath: fs.existsSync(cachePath) ? cachePath : existing.path,
            fileName: safeName,
            bytes: existing.bytes,
            reused: true
        };
    }

    const url = new URL(`/assets/${encodeURIComponent(assetId)}`, `${config.directus.url}/`);
    url.searchParams.set('download', '');

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: '*/*'
            }
        });
    } catch (err) {
        throw new InternalError(`Directus asset download failed: ${err.message || 'network error'}`);
    }

    if (!response.ok) {
        let message = `Directus asset download returned ${response.status}`;
        try {
            const errBody = await response.json();
            message = errBody?.errors?.[0]?.message || errBody?.message || message;
        } catch {
            /* ignore */
        }
        throw new AppError(
            message,
            response.status === 401 || response.status === 403 ? response.status : 502,
            response.status === 401 ? 'DIRECTUS_USER_UNAUTHORIZED' : 'DIRECTUS_USER_FORBIDDEN'
        );
    }

    if (!response.body) {
        throw new InternalError('Directus asset download returned an empty body');
    }

    const tmpPath = `${cachePath}.tmp`;
    try {
        const nodeStream = typeof response.body?.getReader === 'function'
            ? Readable.fromWeb(response.body)
            : response.body;
        let downloaded = 0;
        let lastLoggedMb = 0;
        const expectedLabel = expected != null ? `${Math.round(expected / (1024 * 1024))}MB` : 'unknown';
        console.log('Downloading Directus asset', { fileId: assetId, expectedBytes: expected });
        nodeStream.on?.('data', (chunk) => {
            downloaded += chunk.length;
            const mb = Math.floor(downloaded / (25 * 1024 * 1024));
            if (mb > lastLoggedMb) {
                lastLoggedMb = mb;
                console.log('Directus asset download progress', {
                    fileId: assetId,
                    downloadedMb: Math.round(downloaded / (1024 * 1024)),
                    expected: expectedLabel
                });
            }
        });
        await pipeline(nodeStream, fs.createWriteStream(tmpPath));
        fs.renameSync(tmpPath, cachePath);
    } catch (err) {
        try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
            /* best effort */
        }
        throw new InternalError(`Failed to cache Directus asset: ${err.message || 'write error'}`);
    }

    const bytes = fs.statSync(cachePath).size;
    console.log('Cached Directus asset', { fileId: assetId, bytes, cachePath });
    return {
        cachePath,
        fileName: safeName,
        bytes,
        reused: false
    };
}

export function isMrbAttachment(attachment) {
    return attachment?.isMrb === true;
}

export function canOpenAttachmentInSlicer(attachment) {
    if (attachment?.canOpenInSlicer === true) return true;
    return detectCanOpenInSlicer(
        attachment?.filenameDownload || attachment?.name,
        attachment?.mimeType
    );
}

/**
 * Delete a case attachment record (does NOT delete the underlying Directus file).
 * Verifies ownership before deleting.
 */
export async function deleteCaseAttachment(caseId, attachmentId, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.delete_attachments_token_required'), null, 'directus.delete_attachments_token_required');
    }
    const caseKey = String(caseId || '').trim();
    const attachmentKey = String(attachmentId || '').trim();
    if (!caseKey || !attachmentKey) {
        throw new ValidationError(msg('case.case_attachment_ids_required'), null, 'case.case_attachment_ids_required');
    }

    // Verify attachment belongs to this case before deleting
    await getCaseAttachment(caseKey, attachmentKey, { accessToken });

    await directusFetch(`/items/attachment/${encodeURIComponent(attachmentKey)}`, {
        method: 'DELETE',
        accessToken
    });
}

/**
 * Create a case in Directus as the logged-in user.
 * @param {{ title: string, description?: string, status?: string }} fields
 * @param {{ accessToken: string }} options
 * @returns {Promise<object>} mapped case (no attachments / comments yet)
 */
export async function createCase({ title, description, status } = {}, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.create_case_token_required'), null, 'directus.create_case_token_required');
    }
    const trimmedTitle = String(title || '').trim();
    if (!trimmedTitle) {
        throw new ValidationError(msg('case.title_required'), null, 'case.title_required');
    }

    const body = { title: trimmedTitle };
    const trimmedDesc = String(description || '').trim();
    if (trimmedDesc) body.description = trimmedDesc;
    const trimmedStatus = String(status || '').trim();
    if (trimmedStatus) body.status = trimmedStatus;

    // Stamp an app-owned Timestamp when present (custom field clinicians can grant).
    // Directus accountability dates often cannot be added to custom field allowlists.
    const createdStamp = new Date().toISOString();
    const bodyWithAppCreated = { ...body, created_at: createdStamp };

    let row = null;
    try {
        const payload = await directusFetch('/items/case', {
            method: 'POST',
            accessToken,
            body: bodyWithAppCreated,
            query: { fields: CASE_CORE_FIELDS }
        });
        row = payload?.data;
    } catch (err) {
        // Collection may not have `created_at` yet — create without it.
        const status = Number(err?.statusCode || err?.status || 0);
        const message = String(err?.message || err || '');
        const unknownCreatedAt = status === 400
            || /created_at|unknown field|doesn't exist|invalid payload/i.test(message);
        if (!unknownCreatedAt) throw err;
        const payload = await directusFetch('/items/case', {
            method: 'POST',
            accessToken,
            body,
            query: { fields: CASE_CORE_FIELDS }
        });
        row = payload?.data;
    }

    if (!row?.id) {
        throw new InternalError('Directus did not return a created case id');
    }

    // Prefer Activity (Studio Revisions); then item fields; then server clock for this response only.
    const activityByCaseId = await listCaseActivityTimestampsByCaseIds([row.id], { accessToken });
    let mapped = mapCase(row, {}, {}, {}, activityByCaseId);
    if (!mapped.createdAt && !mapped.updatedAt) {
        for (const fields of CASE_FIELDS_ATTEMPTS) {
            try {
                const refreshed = await directusFetch(`/items/case/${encodeURIComponent(row.id)}`, {
                    accessToken,
                    query: { fields }
                });
                if (refreshed?.data?.id) {
                    mapped = mapCase(refreshed.data, {}, {}, {}, activityByCaseId);
                    if (mapped.createdAt || mapped.updatedAt) break;
                }
            } catch (_) {
                /* try next field set */
            }
        }
    }
    if (!mapped.createdAt && !mapped.updatedAt) {
        mapped = { ...mapped, createdAt: createdStamp, updatedAt: createdStamp };
    }

    const ownerId = mapped.createdBy?.id
        || (row.user_created && typeof row.user_created === 'object' ? row.user_created.id : row.user_created)
        || (await fetchDirectusViewer(accessToken))?.id
        || null;
    if (ownerId) {
        await ensureCaseOwnerJunctionAdmin(row.id, ownerId, { accessToken });
        const collabMap = await listCollaboratorsByCaseIds([row.id], { accessToken });
        if (Array.isArray(collabMap[String(row.id)])) {
            mapped = { ...mapped, collaborators: collabMap[String(row.id)] };
        }
        if (!mapped.createdBy) {
            mapped = {
                ...mapped,
                createdBy: mapDirectusPerson({ id: ownerId }) || mapped.createdBy
            };
        }
    }

    return mapped;
}

/**
 * Update a case's editable fields as the logged-in user.
 * Only fields present in `updates` are sent — omitted keys are left unchanged.
 * @param {string} caseId
 * @param {{ title?: string, description?: string, status?: string }} updates
 * @param {{ accessToken: string }} options
 */
export async function updateCase(caseId, updates = {}, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.update_case_token_required'), null, 'directus.update_case_token_required');
    }
    const caseKey = String(caseId || '').trim();
    if (!caseKey) {
        throw new ValidationError(msg('case.case_id_required'), null, 'case.case_id_required');
    }

    const body = {};
    if (updates.title !== undefined) body.title = String(updates.title || '').trim();
    if (updates.description !== undefined) {
        body.description = String(updates.description || '').trim() || null;
    }
    if (updates.status !== undefined) {
        body.status = String(updates.status || '').trim() || null;
    }

    if (!Object.keys(body).length) {
        throw new ValidationError(msg('directus.case_no_updatable_fields'), null, 'directus.case_no_updatable_fields');
    }
    if (body.title !== undefined && !body.title) {
        throw new ValidationError(msg('case.title_empty'), null, 'case.title_empty');
    }

    const updatedStamp = new Date().toISOString();
    const bodyWithAppUpdated = { ...body, updated_at: updatedStamp };

    let payload;
    try {
        payload = await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
            method: 'PATCH',
            accessToken,
            body: bodyWithAppUpdated,
            query: { fields: CASE_CORE_FIELDS }
        });
    } catch (err) {
        const status = Number(err?.statusCode || err?.status || 0);
        const message = String(err?.message || err || '');
        const unknownUpdatedAt = status === 400
            || /updated_at|unknown field|doesn't exist|invalid payload/i.test(message);
        if (!unknownUpdatedAt) throw err;
        payload = await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
            method: 'PATCH',
            accessToken,
            body,
            query: { fields: CASE_CORE_FIELDS }
        });
    }

    return mapCase(payload?.data || { id: caseKey, ...body }, {});
}

/**
 * Upload a file to Directus's /files endpoint as the logged-in user.
 * Uses the native Node FormData + Blob (Node 18+).
 * @param {{ buffer: Buffer, originalname: string, mimetype?: string }} file  multer file object
 * @param {{ accessToken: string }} options
 * @returns {Promise<{ id: string, filename_download: string, type: string, filesize: number }>}
 */
export async function uploadDirectusFile({ buffer, originalname, mimetype } = {}, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.upload_token_required'), null, 'directus.upload_token_required');
    }
    if (!config.directus.url) {
        throw new DirectusUnavailableError('Directus is not configured. Set DIRECTUS_URL.');
    }
    if (!buffer || !buffer.length) {
        throw new ValidationError(msg('file.buffer_empty'), null, 'file.buffer_empty');
    }

    const url = new URL('/files', `${config.directus.url}/`);
    const safeName = sanitizeFileName(originalname || 'upload');
    const blob = new Blob([buffer], { type: mimetype || 'application/octet-stream' });

    const form = new FormData();
    form.append('file', blob, safeName);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`
                // No Content-Type — fetch sets multipart boundary automatically
            },
            body: form
        });
    } catch (err) {
        throw new InternalError(`Directus file upload failed: ${err.message || 'network error'}`);
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const message = payload?.errors?.[0]?.message
            || payload?.message
            || `Directus file upload returned ${response.status}`;
        if (response.status === 401 || response.status === 403) {
            throw new AppError(message, response.status, response.status === 401
                ? 'DIRECTUS_USER_UNAUTHORIZED'
                : 'DIRECTUS_USER_FORBIDDEN');
        }
        throw new AppError(message, response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    const file = payload?.data;
    if (!file?.id) {
        throw new InternalError('Directus file upload returned no file id');
    }
    return file;
}

/**
 * Create an attachment record in the `attachment` collection linking a
 * Directus file to a case, as the logged-in user.
 * @param {string} caseId
 * @param {string} fileId  Directus file UUID returned by uploadDirectusFile
 * @param {string} name    Display name for the attachment
 * @param {{ accessToken: string, fileMeta?: object }} options
 * @returns {Promise<object>} mapped attachment
 */
export async function createCaseAttachment(caseId, fileId, name, { accessToken, fileMeta } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.create_attachments_token_required'), null, 'directus.create_attachments_token_required');
    }
    const caseKey = String(caseId || '').trim();
    const fileKey = String(fileId || '').trim();
    if (!caseKey || !fileKey) {
        throw new ValidationError(msg('case.case_and_file_ids_required'), null, 'case.case_and_file_ids_required');
    }

    const payload = await directusFetch('/items/attachment', {
        method: 'POST',
        accessToken,
        body: {
            case: caseKey,
            file: fileKey,
            name: String(name || '').trim() || null
        }
    });

    const row = payload?.data;
    if (!row?.id) {
        throw new InternalError('Directus did not return a created attachment id');
    }

    // Prefer a full re-read so filename/size/dates match list responses.
    try {
        const full = await fetchAttachmentRow(row.id, { accessToken });
        if (full?.id) {
            return mapAttachment(full);
        }
    } catch (_) {
        // Fall through to merge upload metadata.
    }

    const meta = fileMeta && typeof fileMeta === 'object' ? fileMeta : {};
    return mapAttachment({
        ...row,
        file: {
            id: fileKey,
            filename_download: meta.filename_download || null,
            type: meta.type || null,
            filesize: meta.filesize ?? null,
            created_on: meta.created_on || null,
            uploaded_on: meta.uploaded_on || null,
            modified_on: meta.modified_on || null
        }
    });
}

/**
 * Look up a Directus user by email for collaborator invite.
 * Prefer call-as-user; fall back to service token (invite glue) if the
 * clinician cannot read directus_users.
 */
export async function lookupDirectusUserByEmail(email, { accessToken } = {}) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
        throw new ValidationError(msg('case.invite_email_required'), null, 'case.invite_email_required');
    }

    const mapRow = (row) => {
        const person = mapDirectusPerson(row);
        if (!person) return null;
        return person;
    };

    if (accessToken) {
        try {
            const payload = await directusFetch('/users', {
                accessToken,
                query: {
                    'filter[email][_eq]': normalized,
                    fields: 'id,email,first_name,last_name',
                    limit: '1'
                }
            });
            const row = Array.isArray(payload?.data) ? payload.data[0] : null;
            const person = mapRow(row);
            if (person) return person;
        } catch (err) {
            console.warn('Directus user lookup as user failed; trying service token:', err.message || err);
        }
    }

    const viaService = await findDirectusUserByEmail(normalized);
    const person = mapRow(viaService);
    if (!person) {
        throw new NotFoundError(msg('directus.user_not_found_by_email'), null, 'directus.user_not_found_by_email');
    }
    return person;
}

/**
 * Resolve actor membership + existing collaborators for a case.
 * @returns {Promise<{
 *   caseKey: string,
 *   caseTitle: string|null,
 *   ownerId: string,
 *   actorId: string,
 *   actorRole: string|null,
 *   actorIsAdmin: boolean,
 *   actorCanInvite: boolean,
 *   existingList: Array,
 *   existingByUserId: Map,
 *   meta: object
 * }>}
 */
export async function getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId } = {}) {
    if (!accessToken) {
        throw new ValidationError(msg('directus.user_token_required'), null, 'directus.user_token_required');
    }
    const caseKey = String(caseId || '').trim();
    if (!caseKey) {
        throw new ValidationError(msg('case.case_id_required'), null, 'case.case_id_required');
    }
    const actorId = String(actorDirectusUserId || '').trim();
    if (!actorId) {
        throw new ValidationError(msg('directus.actor_directus_user_id_required'), null, 'directus.actor_directus_user_id_required');
    }

    const fieldAttempts = [
        [
            'id',
            'title',
            'user_created.id',
            'user_created',
            'collaborators.id',
            'collaborators.directus_users_id.id',
            'collaborators.directus_users_id'
        ].join(','),
        [
            'id',
            'title',
            'user_created',
            'collaborators.id',
            'collaborators.directus_users_id'
        ].join(','),
        'id,title,user_created,collaborators',
        // Last resort: include role (only works when the junction field exists + is allowed)
        [
            'id',
            'title',
            'user_created',
            'collaborators.id',
            'collaborators.role',
            'collaborators.directus_users_id'
        ].join(',')
    ];

    let meta = null;
    let lastErr = null;
    for (const fields of fieldAttempts) {
        try {
            const metaPayload = await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
                accessToken,
                query: { fields }
            });
            if (metaPayload?.data?.id) {
                meta = metaPayload.data;
                break;
            }
        } catch (err) {
            lastErr = err;
        }
    }
    if (!meta?.id) {
        throw lastErr || new NotFoundError('Case not found');
    }

    let ownerId = '';
    if (meta.user_created && typeof meta.user_created === 'object') {
        ownerId = String(meta.user_created.id || '');
    } else if (meta.user_created != null && meta.user_created !== '') {
        ownerId = String(meta.user_created);
    }

    // Clinician field ACL often hides user_created. Case was already readable as the
    // user — enrich owner id with service token for that id only (same pattern as Activity).
    if (!ownerId) {
        try {
            const ownerPayload = await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
                query: { fields: 'id,user_created' }
            });
            const uc = ownerPayload?.data?.user_created;
            if (uc && typeof uc === 'object') {
                ownerId = String(uc.id || '');
            } else if (uc != null && uc !== '') {
                ownerId = String(uc);
            }
        } catch (err) {
            console.warn('Case owner enrichment via service token failed:', err.message || err);
        }
    }

    // listCollaboratorsByCaseIds already retries without `role` and enriches via service.
    let existingList = mapCollaboratorsFromCaseRow(meta);
    const byCase = await listCollaboratorsByCaseIds([caseKey], { accessToken });
    const listed = Array.isArray(byCase[caseKey]) ? byCase[caseKey] : [];
    if (listed.length) {
        const merged = new Map();
        for (const member of existingList) {
            if (member?.id) merged.set(String(member.id), member);
        }
        for (const member of listed) {
            if (!member?.id) continue;
            const key = String(member.id);
            const prev = merged.get(key);
            merged.set(key, {
                ...prev,
                ...member,
                role: normalizeCaseCollabRole(member.role || prev?.role),
                junctionId: member.junctionId || prev?.junctionId || null
            });
        }
        existingList = [...merged.values()];
    }

    existingList = applyCaseCollaboratorRoleOverrides(caseKey, existingList);

    // If still missing junction ids, read junction rows without requiring `role`.
    if (existingList.some((m) => !m.junctionId) || !existingList.length) {
        try {
            let rows = [];
            for (const [caseField, fields] of [
                ['case_id', 'id,directus_users_id,case_id,role'],
                ['case_id', 'id,directus_users_id,case_id'],
                ['case', 'id,directus_users_id,case,role'],
                ['case', 'id,directus_users_id,case']
            ]) {
                try {
                    const junctionPayload = await directusFetch('/items/case_directus_users', {
                        query: {
                            [`filter[${caseField}][_eq]`]: caseKey,
                            fields,
                            limit: '100'
                        }
                    });
                    rows = Array.isArray(junctionPayload?.data) ? junctionPayload.data : [];
                    if (rows.length) break;
                } catch (err) {
                    if (isMissingRoleFieldError(err)) continue;
                }
            }
            if (rows.length) {
                const byUser = new Map(existingList.map((m) => [String(m.id), m]));
                for (const row of rows) {
                    const userRef = row?.directus_users_id;
                    const userId = userRef && typeof userRef === 'object'
                        ? String(userRef.id || '')
                        : String(userRef || '');
                    if (!userId) continue;
                    const prev = byUser.get(userId) || { id: userId };
                    byUser.set(userId, {
                        ...prev,
                        id: userId,
                        role: normalizeCaseCollabRole(
                            row?.role != null ? row.role : prev.role
                        ),
                        junctionId: row?.id != null ? String(row.id) : (prev.junctionId || null)
                    });
                }
                existingList = [...byUser.values()];
            }
        } catch (err) {
            console.warn('Junction id enrichment failed:', err.message || err);
        }
    }

    existingList = applyCaseCollaboratorRoleOverrides(caseKey, existingList);

    const actorIsOwner = Boolean(ownerId && ownerId === actorId);
    const actorMembership = existingList.find((c) => String(c.id) === actorId);
    let actorRole = null;
    if (actorIsOwner) {
        actorRole = CASE_COLLAB_ROLES.ADMIN;
    } else if (actorMembership) {
        actorRole = normalizeCaseCollabRole(actorMembership.role);
    }

    const actorIsAdmin = actorRole === CASE_COLLAB_ROLES.ADMIN;
    const actorCanInvite = actorIsAdmin || actorRole === CASE_COLLAB_ROLES.COLLABORATOR;

    // Backfill owner onto the junction as admin (existing cases created before role field).
    if (ownerId) {
        const ownerOnJunction = existingList.find((c) => String(c.id) === String(ownerId));
        const ownerJunctionRole = ownerOnJunction
            ? normalizeCaseCollabRole(ownerOnJunction.role)
            : null;
        if (!ownerOnJunction || ownerJunctionRole !== CASE_COLLAB_ROLES.ADMIN) {
            const ensured = await ensureCaseOwnerJunctionAdmin(caseKey, ownerId, { accessToken });
            if (ensured) {
                const refreshed = await listCollaboratorsByCaseIds([caseKey], { accessToken });
                if (Array.isArray(refreshed[caseKey]) && refreshed[caseKey].length) {
                    existingList = refreshed[caseKey];
                }
            }
        }
    }

    const existingByUserId = new Map();
    const junctionRows = Array.isArray(meta.collaborators) ? meta.collaborators : [];
    for (const row of junctionRows) {
        const userRef = row?.directus_users_id;
        const userId = userRef && typeof userRef === 'object'
            ? String(userRef.id || '')
            : String(userRef || '');
        const junctionId = row?.id != null ? String(row.id) : '';
        if (userId && junctionId) {
            existingByUserId.set(userId, {
                junctionId,
                role: normalizeCaseCollabRole(row?.role)
            });
        }
    }
    for (const member of existingList) {
        if (!member?.id) continue;
        const key = String(member.id);
        if (!existingByUserId.has(key) && member.junctionId) {
            existingByUserId.set(key, {
                junctionId: String(member.junctionId),
                role: normalizeCaseCollabRole(member.role)
            });
        } else if (existingByUserId.has(key)) {
            const prev = existingByUserId.get(key);
            existingByUserId.set(key, {
                ...prev,
                role: normalizeCaseCollabRole(member.role || prev.role)
            });
        }
    }

    return {
        caseKey,
        caseTitle: meta.title != null ? String(meta.title) : null,
        ownerId,
        actorId,
        actorRole,
        actorIsAdmin,
        actorCanInvite,
        existingList,
        existingByUserId,
        meta
    };
}

/**
 * Add one collaborator (admin path / invite approve). Idempotent if already present.
 */
export async function addCaseCollaborator(
    caseId,
    userId,
    role,
    { accessToken, actorDirectusUserId } = {}
) {
    const ctx = await getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId });
    if (!ctx.actorIsAdmin) {
        throw new ForbiddenError(msg('case.people_add_admin_only'), null, 'case.people_add_admin_only');
    }
    const uid = String(userId || '').trim();
    if (!uid || uid === ctx.ownerId) {
        return {
            id: ctx.caseKey,
            createdById: ctx.ownerId,
            collaborators: ctx.existingList
        };
    }
    let nextRole = normalizeCaseCollabRole(role);
    const desiredByUserId = new Map();
    for (const member of ctx.existingList) {
        if (member.id === ctx.ownerId) continue;
        desiredByUserId.set(String(member.id), normalizeCaseCollabRole(member.role));
    }
    desiredByUserId.set(uid, nextRole);

    return setCaseCollaborators(
        caseId,
        [...desiredByUserId.entries()].map(([id, r]) => ({ userId: id, role: r })),
        { accessToken, actorDirectusUserId, allowCollaboratorCreates: false }
    );
}

/**
 * Add a collaborator after a verified signup-invite redeem (service token only).
 * Callers must validate the invite token before invoking this.
 */
export async function addCaseCollaboratorAsSystem(caseId, userId, role) {
    const caseKey = String(caseId || '').trim();
    const uid = String(userId || '').trim();
    if (!caseKey || !uid) {
        throw new ValidationError(msg('case.case_and_user_required'), null, 'case.case_and_user_required');
    }
    const nextRole = normalizeCaseCollabRole(role);
    const existingByUserId = await loadCaseJunctionByUserId(caseKey, {});
    const desiredByUserId = new Map();
    for (const [id, existing] of existingByUserId.entries()) {
        desiredByUserId.set(String(id), normalizeCaseCollabRole(existing.role));
    }
    desiredByUserId.set(uid, nextRole);

    if (!existingByUserId.has(uid) || existingByUserId.get(uid)?.role !== nextRole) {
        await syncCaseCollaboratorsViaJunction(
            caseKey,
            desiredByUserId,
            existingByUserId,
            {}
        );
    }
    setCaseCollaboratorRoleOverride(caseKey, uid, nextRole);

    const collabMap = await listCollaboratorsByCaseIds([caseKey], {});
    return {
        id: caseKey,
        collaborators: collabMap[caseKey] || []
    };
}

/**
 * Replace the collaborator set on a case (Directus M2M + junction role).
 * Owner is always admin (user_created).
 * Admins may add/remove/change roles.
 * Collaborators must use POST …/invites (pending admin approval) — PUT cannot add.
 * @param {string} caseId
 * @param {Array<{ userId: string, role?: string }|string>} collaborators
 * @param {{ accessToken: string, actorDirectusUserId: string, allowCollaboratorCreates?: boolean }} options
 */
export async function setCaseCollaborators(caseId, collaborators, {
    accessToken,
    actorDirectusUserId,
    allowCollaboratorCreates = false
} = {}) {
    const ctx = await getCaseCollabActorContext(caseId, { accessToken, actorDirectusUserId });
    const {
        caseKey,
        ownerId,
        actorIsAdmin,
        actorCanInvite,
        existingByUserId
    } = ctx;

    if (!actorCanInvite && !actorIsAdmin) {
        throw new ForbiddenError(msg('case.people_change_forbidden'), null, 'case.people_change_forbidden');
    }
    if (!actorIsAdmin && !allowCollaboratorCreates) {
        // Collaborators use the invite API for adds; PUT is admin manage only.
        // Still allow if they're somehow called with empty creates — block creates explicitly below.
    }

    const desiredByUserId = new Map();
    const rawList = Array.isArray(collaborators) ? collaborators : [];
    for (const entry of rawList) {
        let userId = '';
        let role = CASE_COLLAB_ROLES.COLLABORATOR;
        if (typeof entry === 'string') {
            userId = entry.trim();
        } else if (entry && typeof entry === 'object') {
            userId = String(entry.userId || entry.id || entry.directus_users_id || '').trim();
            role = normalizeCaseCollabRole(entry.role);
        }
        if (!userId || (ownerId && userId === ownerId)) continue;
        if (!actorIsAdmin && role === CASE_COLLAB_ROLES.ADMIN) {
            role = CASE_COLLAB_ROLES.COLLABORATOR;
        }
        desiredByUserId.set(userId, role);
    }

    // Owner stays admin on the junction when possible. Do not hard-fail People updates
    // if backfill/promote hits a Directus 500 (e.g. duplicate after manual add).
    if (ownerId) {
        desiredByUserId.set(String(ownerId), CASE_COLLAB_ROLES.ADMIN);
        await ensureCaseOwnerJunctionAdmin(caseKey, ownerId, { accessToken, required: false });
    }

    // Prefer authoritative junction ids/roles (service) so role updates PATCH the right row.
    const junctionMap = await loadCaseJunctionByUserId(caseKey, { accessToken });
    const effectiveExisting = junctionMap.size ? junctionMap : existingByUserId;
    for (const [userId, existing] of effectiveExisting.entries()) {
        const override = getCaseCollaboratorRoleOverride(caseKey, userId);
        if (override) {
            existing.role = normalizeCaseCollabRole(override);
        }
    }

    const toDelete = [];
    const toCreate = [];
    const toUpdate = [];

    for (const [userId, existing] of effectiveExisting.entries()) {
        if (!existing?.junctionId) continue;
        // Never mutate/delete the owner row here — UI locks them; promote is best-effort above.
        if (ownerId && userId === String(ownerId)) {
            continue;
        }
        if (!desiredByUserId.has(userId)) {
            toDelete.push(existing.junctionId);
            continue;
        }
        const nextRole = desiredByUserId.get(userId);
        if (nextRole !== existing.role) {
            toUpdate.push({
                userId,
                junctionId: existing.junctionId,
                id: existing.junctionId,
                role: nextRole
            });
        }
    }
    for (const [userId, role] of desiredByUserId.entries()) {
        if (ownerId && userId === String(ownerId)) continue;
        const existing = effectiveExisting.get(userId);
        if (existing?.junctionId) continue;
        toCreate.push({
            directus_users_id: userId,
            role: toDirectusCaseCollabRole(role)
        });
    }

    if (!toDelete.length && !toCreate.length && !toUpdate.length) {
        // Desired roles differ but we lack junction ids — cannot PATCH nested update.
        const unresolved = [...desiredByUserId.entries()].some(([userId, role]) => {
            const existing = effectiveExisting.get(userId);
            if (!existing) return false;
            return !existing.junctionId && normalizeCaseCollabRole(role) !== existing.role;
        });
        if (unresolved) {
            throw new AppError(
                msg('case.collaborators_junction_unresolved'),
                403,
                'CASE_COLLABORATORS_UPDATE_FAILED',
                'case.collaborators_junction_unresolved'
            );
        }
    }

    if (!actorIsAdmin) {
        if (toDelete.length || toUpdate.length) {
            throw new ForbiddenError(
                msg('case.people_change_denied'),
                null,
                'case.people_change_denied'
            );
        }
        if (toCreate.length && !allowCollaboratorCreates) {
            throw new ForbiddenError(
                msg('case.people_add_needs_admin'),
                null,
                'case.people_add_needs_admin'
            );
        }
    }

    if (toDelete.length || toCreate.length || toUpdate.length) {
        const buildCollabFailure = async (errors = []) => {
            const details = errors
                .map((e) => String(e?.message || e || '').trim())
                .filter(Boolean);
            console.error('Case collaborators update failed', {
                caseKey,
                details: details.slice(0, 5),
                probe: await probeServiceJunctionAccess()
            });
            return new AppError(
                "Couldn't update people on this case. Please try again.",
                403,
                'CASE_COLLABORATORS_UPDATE_FAILED'
            );
        };

        const roleOnly = toUpdate.length > 0 && !toCreate.length && !toDelete.length;
        const writeErrors = [];

        // Role-only: PATCH junction rows directly — do not fall through to /items/case
        // (service token often lacks `case` access and pollutes the error with that).
        if (roleOnly) {
            const roleTokens = [];
            if (accessToken) roleTokens.push({ label: 'user', token: accessToken });
            if (actorIsAdmin && config.directus.token) {
                roleTokens.push({ label: 'service', token: undefined });
            }
            for (const attempt of roleTokens) {
                try {
                    await patchCollaboratorRolesViaJunction(caseKey, toUpdate, {
                        accessToken: attempt.token
                    });
                    const collabMap = await listCollaboratorsByCaseIds([caseKey], { accessToken });
                    return {
                        id: caseKey,
                        createdById: ownerId,
                        collaborators: collabMap[caseKey] || []
                    };
                } catch (err) {
                    writeErrors.push(err);
                    console.info(
                        'Junction role PATCH failed:',
                        attempt.label,
                        err.message || err,
                        err.directusExtensions || ''
                    );
                }
            }
            throw await buildCollabFailure(writeErrors);
        }

        const nestedBody = { collaborators: {} };
        if (toCreate.length) nestedBody.collaborators.create = toCreate;
        if (toUpdate.length) {
            nestedBody.collaborators.update = toUpdate.map((u) => ({
                id: u.junctionId || u.id,
                role: toDirectusCaseCollabRole(u.role)
            }));
        }
        if (toDelete.length) nestedBody.collaborators.delete = toDelete;

        // Nested /items/case — clinician first (service often has no access to `case`).
        const nestedAttempts = [];
        if (accessToken) nestedAttempts.push({ label: 'user', token: accessToken });
        if (actorIsAdmin && config.directus.token) {
            nestedAttempts.push({ label: 'service', token: undefined });
        }

        const syncDesiredByUserId = new Map(desiredByUserId);
        if (ownerId) {
            const key = String(ownerId);
            const ex = effectiveExisting.get(key);
            if (ex) syncDesiredByUserId.set(key, ex.role);
            else syncDesiredByUserId.delete(key);
        }

        let nestedOk = false;
        for (const attempt of nestedAttempts) {
            try {
                await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
                    method: 'PATCH',
                    ...(attempt.token ? { accessToken: attempt.token } : {}),
                    body: nestedBody
                });
                nestedOk = true;
                break;
            } catch (err) {
                writeErrors.push(err);
                console.info(
                    'Nested collaborators PATCH failed:',
                    attempt.label,
                    err.message || err
                );
                if (isCaseCollectionDeniedError(err) && attempt.label === 'service') {
                    continue;
                }
            }
        }

        if (!nestedOk) {
            const junctionTokens = [];
            if (accessToken) junctionTokens.push(accessToken);
            if (actorIsAdmin && config.directus.token) junctionTokens.push(undefined);

            let junctionOk = false;
            for (const token of junctionTokens) {
                try {
                    await syncCaseCollaboratorsViaJunction(
                        caseKey,
                        syncDesiredByUserId,
                        effectiveExisting,
                        { accessToken: token }
                    );
                    junctionOk = true;
                    break;
                } catch (junctionErr) {
                    writeErrors.push(junctionErr);
                    console.info(
                        'Junction collaborator sync failed:',
                        token ? 'user' : 'service',
                        junctionErr.message || junctionErr
                    );
                }
            }
            if (!junctionOk) {
                throw await buildCollabFailure(writeErrors);
            }
        }
    }

    const collabMap = await listCollaboratorsByCaseIds([caseKey], { accessToken });
    return {
        id: caseKey,
        createdById: ownerId,
        collaborators: collabMap[caseKey] || []
    };
}

/**
 * Create/update/delete rows on case_directus_users when nested M2M PATCH is unavailable.
 * @param {string} caseKey
 * @param {Map<string, string>} desiredByUserId userId -> role
 * @param {Map<string, { junctionId: string, role: string }>} existingByUserId
 */
async function syncCaseCollaboratorsViaJunction(caseKey, desiredByUserId, existingByUserId, { accessToken } = {}) {
    const junction = 'case_directus_users';
    const opts = accessToken ? { accessToken } : {};

    for (const [userId, existing] of existingByUserId.entries()) {
        if (!existing?.junctionId) {
            throw new InternalError(`Missing junction id for collaborator ${userId}`);
        }
        if (!desiredByUserId.has(userId)) {
            await directusFetch(`/items/${junction}/${encodeURIComponent(existing.junctionId)}`, {
                method: 'DELETE',
                ...opts
            });
            continue;
        }
        const nextRole = desiredByUserId.get(userId);
        if (nextRole !== existing.role) {
            await directusFetch(`/items/${junction}/${encodeURIComponent(existing.junctionId)}`, {
                method: 'PATCH',
                ...opts,
                body: { role: toDirectusCaseCollabRole(nextRole) }
            });
        }
    }

    const caseFieldCandidates = ['case_id', 'case'];
    for (const [userId, role] of desiredByUserId.entries()) {
        if (existingByUserId.has(userId)) continue;
        let created = false;
        let lastErr = null;
        const bodyVariants = [
            { directus_users_id: userId, role: toDirectusCaseCollabRole(role) },
            { directus_users_id: userId }
        ];
        for (const caseField of caseFieldCandidates) {
            for (const extra of bodyVariants) {
                try {
                    await directusFetch(`/items/${junction}`, {
                        method: 'POST',
                        ...opts,
                        body: {
                            [caseField]: caseKey,
                            ...extra
                        }
                    });
                    created = true;
                    break;
                } catch (err) {
                    lastErr = err;
                }
            }
            if (created) break;
        }
        if (!created) {
            throw lastErr || new InternalError('Failed to create case collaborator junction row');
        }
    }
}
