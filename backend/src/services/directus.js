import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../config/index.js';
import { AppError, InternalError, NotFoundError, ValidationError } from '../utils/errors.js';
import { msg } from '../i18n/index.js';
import {
    listMembersByCaseIds,
    addCaseCreatorAsAdmin,
    parseCaseRole,
    toDisplayMember,
    CASE_COLLAB_ROLES
} from './caseCollaborators.js';
import { findAppUserIdByDirectusExternalId } from '../auth/identityStore.js';
import { createNotification } from './notifications.js';

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

/** Where an asset lives in the cache; the name keeps the original extension. */
function assetCacheName(assetId, filenameDownload) {
    const safeName = sanitizeFileName(filenameDownload || `${assetId}.bin`);
    return { safeName, cachePath: path.join(ensureCacheDir(), `${assetId}-${safeName}`) };
}

/** Cache location used before the cache moved to the slicer-gui volume. */
function legacyAssetCachePath(assetId, safeName) {
    return path.join(process.cwd(), 'data', 'directus-cache', `${assetId}-${safeName}`);
}

/** A complete cached file (right size when known), or null. */
function usableCachedFile(candidate, expectedSize) {
    if (!candidate || !fs.existsSync(candidate)) return null;
    const stat = fs.statSync(candidate);
    if (expectedSize != null && stat.size !== expectedSize) return null;
    return { path: candidate, bytes: stat.size };
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

export function mapDirectusPerson(user) {
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
            role: parseCaseRole(entry?.role) || CASE_COLLAB_ROLES.READ_ONLY,
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
 * Collaborators for case ids, from the Directus junction (service token). Failures return {} so the
 * case list still loads; a case with no entry falls back to the members embedded in its own row.
 */
async function listCollaboratorsByCaseIds(caseIds) {
    try {
        const byCase = await listMembersByCaseIds(caseIds);
        return Object.fromEntries(
            Object.entries(byCase).map(([caseId, members]) => [caseId, members.map(toDisplayMember)])
        );
    } catch (err) {
        console.warn('Directus collaborators fetch failed (cases still listed):', err.message || err);
        return {};
    }
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
export async function createCaseComment(caseId, commentText, { accessToken, actorAppUserId = null } = {}) {
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

    // Ensure the case exists / is readable before writing; grab title for mention notifications.
    const caseData = await directusFetch(`/items/case/${encodeURIComponent(caseKey)}`, {
        accessToken,
        query: { fields: 'id,title' }
    });
    const caseTitle = String(caseData?.data?.title || '').trim() || 'a case';

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

    const mentionIds = [...extractMentionUserIds(row?.comment)];
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

    // Notify each @-mentioned user. Skip the commenter themselves; silently skip
    // anyone whose Directus UUID is not linked to an app account.
    console.log('[mention-notif] mentionIds:', mentionIds, 'actorAppUserId:', actorAppUserId, 'rawComment:', row?.comment);
    if (mentionIds.length) {
        const actorName = mapped.author?.name || 'Someone';
        const notifBody = String(mapped.body || '').slice(0, 200);
        for (const mentionedUuid of mentionIds) {
            try {
                const appUserId = findAppUserIdByDirectusExternalId(mentionedUuid);
                console.log('[mention-notif] uuid:', mentionedUuid, '→ appUserId:', appUserId, 'skip?', !appUserId || appUserId === actorAppUserId);
                if (!appUserId || appUserId === actorAppUserId) continue;
                const notif = createNotification({
                    userId: appUserId,
                    type: 'mention',
                    title: `${actorName} mentioned you in "${caseTitle}"`,
                    body: notifBody,
                    caseId: caseKey
                });
                console.log('[mention-notif] created:', notif?.id);
            } catch (err) {
                console.warn('Mention notification skipped:', err.message || err);
            }
        }
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
        listCollaboratorsByCaseIds(caseIds),
        listCaseActivityTimestampsByCaseIds(caseIds, { accessToken })
    ]);
    const cases = rows.map((row) => mapCase(
        row,
        commentsByCaseId,
        attachmentsByCaseId,
        collaboratorsByCaseId,
        activityByCaseId
    ));

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

/** In-flight Directus asset fetches, keyed by cache path (see ensureDirectusAssetCached). */
const inflightAssetFills = new Map();

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

    const { safeName, cachePath } = assetCacheName(assetId, filenameDownload);
    const expected = expectedSize != null && Number.isFinite(Number(expectedSize))
        ? Number(expectedSize)
        : null;

    const existing = usableCachedFile(cachePath, expected)
        || usableCachedFile(legacyAssetCachePath(assetId, safeName), expected);
    if (existing) {
        if (existing.path !== cachePath) {
            try {
                ensureCacheDir();
                // Async: a synchronous copy of a large file would stall every other request.
                await fs.promises.copyFile(existing.path, cachePath);
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

    // Concurrent requests for the same uncached file (two collaborators, or a viewer plus a
    // download) share one fetch. Sharing is safe: every caller has already passed its own
    // access check before reaching here, and a single fetch/rename avoids a shared .tmp race.
    const inFlight = inflightAssetFills.get(cachePath);
    if (inFlight) return inFlight;

    const fill = downloadAssetToCache({ assetId, cachePath, safeName, expected, accessToken });
    inflightAssetFills.set(cachePath, fill);
    try {
        return await fill;
    } finally {
        inflightAssetFills.delete(cachePath);
    }
}

/**
 * Open a streaming download of a Directus asset as the caller. Failures are mapped to app errors before
 * any body is read; an aborted `signal` rejects with the abort error.
 * @returns {Promise<Response>} an ok response with a body
 */
export async function fetchDirectusAsset(fileId, accessToken, signal) {
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

    const url = new URL(`/assets/${encodeURIComponent(assetId)}`, `${config.directus.url}/`);
    url.searchParams.set('download', '');

    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: '*/*'
            },
            signal
        });
    } catch (err) {
        if (signal?.aborted) throw err;
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
    return response;
}

/**
 * The cached copy of an asset when a complete one is on disk, else null. Never downloads or copies
 * anything, so it is cheap enough to call when deciding how to serve a request.
 */
export function findCachedDirectusAsset({ fileId, filenameDownload = null, expectedSize = null } = {}) {
    const assetId = String(fileId || '').trim();
    if (!assetId) return null;
    const { safeName, cachePath } = assetCacheName(assetId, filenameDownload);
    const expected = expectedSize != null && Number.isFinite(Number(expectedSize)) ? Number(expectedSize) : null;
    const found = usableCachedFile(cachePath, expected)
        || usableCachedFile(legacyAssetCachePath(assetId, safeName), expected);
    return found ? { cachePath: found.path, fileName: safeName, bytes: found.bytes } : null;
}

/** Fetch one Directus asset into the cache: written to a .tmp file, renamed when complete. */
async function downloadAssetToCache({ assetId, cachePath, safeName, expected, accessToken }) {
    const response = await fetchDirectusAsset(assetId, accessToken);

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

    const creatorId = mapped.createdBy?.id
        || (row.user_created && typeof row.user_created === 'object' ? row.user_created.id : row.user_created)
        || (await fetchDirectusViewer(accessToken))?.id
        || null;
    if (!creatorId) {
        throw new InternalError('Could not determine who created the case');
    }
    // The creator is an ordinary admin row on the junction; nothing else marks them as owner.
    await addCaseCreatorAsAdmin(row.id, creatorId);
    const collabMap = await listCollaboratorsByCaseIds([row.id]);
    if (Array.isArray(collabMap[String(row.id)])) {
        mapped = { ...mapped, collaborators: collabMap[String(row.id)] };
    }
    if (!mapped.createdBy) {
        mapped = { ...mapped, createdBy: mapDirectusPerson({ id: creatorId }) || mapped.createdBy };
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
