import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../config/index.js';
import { AppError, InternalError, NotFoundError, ValidationError } from '../utils/errors.js';

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

const CASE_LIST_FIELDS = [
    'id',
    'title',
    'description',
    'status',
    'attachments.id',
    'attachments.name',
    'attachments.file.id',
    'attachments.file.filename_download',
    'attachments.file.type',
    'attachments.file.filesize'
].join(',');

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

function mapAttachment(row) {
    const file = row?.file && typeof row.file === 'object' ? row.file : null;
    const fileId = file?.id ?? (typeof row?.file === 'string' ? row.file : null);
    const filenameDownload = file?.filename_download || null;
    const mimeType = file?.type || null;
    const filesizeRaw = file?.filesize;
    const filesize = filesizeRaw != null && filesizeRaw !== ''
        ? Number(filesizeRaw)
        : null;
    const lowerName = String(filenameDownload || row?.name || '').toLowerCase();
    const isMrb = lowerName.endsWith('.mrb')
        || mimeType === 'application/x-mrb'
        || mimeType === 'application/vnd.slicer.mrb';

    return {
        id: row?.id ?? null,
        name: row?.name ?? null,
        fileId,
        filenameDownload,
        mimeType,
        filesize: Number.isFinite(filesize) ? filesize : null,
        isMrb
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
    if (!user || typeof user !== 'object') return null;
    return {
        id: user.id ?? null,
        name: formatPersonName(user) || 'Unknown',
        email: user.email || null
    };
}

function mapComment(row, usersById = {}) {
    return {
        id: row?.id ?? null,
        caseId: row?.item ?? null,
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

function mapCase(row, commentsByCaseId = {}) {
    const attachments = Array.isArray(row?.attachments)
        ? row.attachments.map(mapAttachment).filter((a) => a.id)
        : [];
    const caseId = row?.id ?? null;
    const comments = caseId && Array.isArray(commentsByCaseId[caseId])
        ? commentsByCaseId[caseId]
        : [];
    return {
        id: caseId,
        title: row?.title ?? null,
        description: row?.description ?? null,
        status: row?.status ?? null,
        attachments,
        comments
    };
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
        const message = payload?.errors?.[0]?.message
            || payload?.message
            || `Directus returned ${response.status}`;
        if (accessToken && (response.status === 401 || response.status === 403)) {
            throw new AppError(message, response.status, response.status === 401
                ? 'DIRECTUS_USER_UNAUTHORIZED'
                : 'DIRECTUS_USER_FORBIDDEN');
        }
        const status = response.status >= 400 && response.status < 600 ? response.status : 502;
        throw new AppError(message, status === 401 || status === 403 ? 502 : status);
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
 * Create a Directus user with the service token (active, password set).
 * @param {{ email: string, password: string, roleId: string, firstName?: string, lastName?: string }} input
 */
export async function createDirectusUser({ email, password, roleId, firstName, lastName }) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
        throw new ValidationError('Email is required');
    }
    if (!password || String(password).length < 8) {
        throw new ValidationError('Password must be at least 8 characters');
    }
    const role = String(roleId || '').trim();
    if (!role) {
        throw new ValidationError('Directus role id is required (DIRECTUS_DEFAULT_ROLE_ID)');
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
    const id = String(directusUserId || '').trim();
    if (!id) {
        throw new ValidationError('Directus user id is required');
    }
    if (!newPassword || String(newPassword).length < 8) {
        throw new ValidationError('Password must be at least 8 characters');
    }

    const payload = await directusFetch(`/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { password: String(newPassword) }
    });
    return payload?.data || null;
}

/**
 * List Directus activity comments for the `case` collection (one request),
 * resolving @user-uuid mentions to first/last names.
 * @returns {Promise<Record<string, Array>>} comments keyed by case id
 */
export async function listCaseCommentsByCaseId({ limit = 200, accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError('Directus user access token is required for case comments');
    }
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const payload = await directusFetch('/comments', {
        accessToken,
        query: {
            'filter[collection][_eq]': 'case',
            fields: [
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
            sort: 'date_created',
            limit: String(safeLimit)
        }
    });

    const rows = Array.isArray(payload?.data) ? payload.data : [];
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

const COMMENT_FIELDS = [
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
].join(',');

/**
 * Create a Directus activity comment on a case (as the logged-in user).
 * @param {string} caseId
 * @param {string} commentText
 * @param {{ accessToken: string }} options
 * @returns {Promise<object>} mapped comment
 */
export async function createCaseComment(caseId, commentText, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError('Directus user access token is required to post comments');
    }
    const caseKey = String(caseId || '').trim();
    const body = String(commentText || '').trim();
    if (!caseKey) {
        throw new ValidationError('caseId is required');
    }
    if (!body) {
        throw new ValidationError('Comment text is required');
    }
    if (body.length > 5000) {
        throw new ValidationError('Comment must be 5000 characters or less');
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
        try {
            const refreshed = await directusFetch(`/comments/${encodeURIComponent(createdId)}`, {
                accessToken,
                query: { fields: COMMENT_FIELDS }
            });
            if (refreshed?.data) row = refreshed.data;
        } catch (err) {
            console.warn('Directus comment re-fetch after create failed:', err.message || err);
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
 */
export async function listCases({ limit = 50, accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError('Directus user access token is required to list cases');
    }
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const [payload, commentsByCaseId] = await Promise.all([
        directusFetch('/items/case', {
            accessToken,
            query: {
                limit: String(safeLimit),
                fields: CASE_LIST_FIELDS
            }
        }),
        listCaseCommentsByCaseId({ accessToken }).catch((err) => {
            console.warn('Directus comments fetch failed:', err.message || err);
            return {};
        })
    ]);

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => mapCase(row, commentsByCaseId));
}

/**
 * Fetch one attachment and verify it belongs to the given case.
 */
export async function getCaseAttachment(caseId, attachmentId, { accessToken } = {}) {
    if (!accessToken) {
        throw new ValidationError('Directus user access token is required for attachments');
    }
    const caseKey = String(caseId || '').trim();
    const attachmentKey = String(attachmentId || '').trim();
    if (!caseKey || !attachmentKey) {
        throw new ValidationError('caseId and attachmentId are required');
    }

    const payload = await directusFetch(`/items/attachment/${encodeURIComponent(attachmentKey)}`, {
        accessToken,
        query: {
            fields: [
                'id',
                'name',
                'case',
                'file.id',
                'file.filename_download',
                'file.type',
                'file.filesize'
            ].join(',')
        }
    });

    const row = payload?.data;
    if (!row?.id) {
        throw new NotFoundError('Attachment not found');
    }

    const owningCase = typeof row.case === 'object' ? row.case?.id : row.case;
    if (String(owningCase) !== caseKey) {
        throw new NotFoundError('Attachment not found on this case');
    }

    const mapped = mapAttachment(row);
    if (!mapped.fileId) {
        throw new ValidationError('Attachment has no Directus file');
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
        throw new ValidationError('Directus file id is required');
    }
    if (!accessToken) {
        throw new ValidationError('Directus user access token is required to download assets');
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
