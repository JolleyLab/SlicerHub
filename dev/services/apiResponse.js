/**
 * Reading API responses the same way everywhere.
 *
 *   readJson(response)                      the JSON body, or {} when there is none
 *   apiErrorText(error)                     the browser's own text for a keyed API error, or null
 *   apiError(response, data, fallback, opts) an Error with .status, .code and .payload (the body)
 *   parseApiResponse(response, fallback)    the body of a successful response, else throws apiError
 *   apiRequest(path, { method, body })      fetch an /api path with the session cookie, then parseApiResponse
 *                                           (body: JSON, or FormData for uploads)
 *
 * With { friendly: true } the message goes through friendlyCasesError, so the person never
 * sees server jargon.
 */

import { t } from '../i18n/index.js';
import { API_URL } from '../config.js';

/**
 * Map API errors to short user-facing copy.
 */
export function friendlyCasesError(raw, fallback = 'Something went wrong. Please try again.', status = 0, code = null) {
    const text = String(raw || '').trim();
    const lower = text.toLowerCase();

    if (
        /sign in once with your email and password|account connection expired|connect to your account/i.test(lower)
    ) {
        return text;
    }

    if (code === 'UPLOAD_NETWORK_ERROR') {
        return t('errors.serverUnreachable');
    }

    if (
        code === 'CASE_COLLABORATORS_UPDATE_FAILED'
        || code === 'CASE_OWNER_JUNCTION_MISSING'
        || code === 'CASE_COLLABORATOR_JUNCTION_NOT_FOUND'
    ) {
        return t('errors.peopleSaveFailed');
    }

    if (
        /only case admins can|collaborators can invite|pending invite|already on this case|already has a pending/i.test(lower)
        && text.length <= 160
        && !/directus|collection|case_directus|grant |token|probe|INTERNAL_SERVER/i.test(lower)
    ) {
        return text;
    }

    if (status === 401 || /unauthorized|session expired|jwt expired/i.test(lower)) {
        return t('errors.sessionExpired');
    }
    if (
        status === 403
        || /permission|forbidden|access fields|access collection|not allowed to|denied|directus:/i.test(lower)
    ) {
        return t('errors.noPermission');
    }
    if (/no (directus )?user found with that email/i.test(lower)) {
        return t('errors.noAccountWithEmail');
    }
    if (status === 404 || /\bnot found\b/i.test(lower)) {
        return t('errors.itemNotFound');
    }
    if (status === 413 || /file too large|payload too large|entity too large/i.test(lower)) {
        return t('errors.fileTooLarge');
    }
    if (/network|failed to fetch|load failed|econnrefused|timed out|timeout/i.test(lower)) {
        return t('errors.serverUnreachable');
    }
    if (/slicer-gui|container|docker|image built|vnc|seat/i.test(lower)) {
        return t('errors.viewerStartFailed');
    }
    if (/sessionToken|session not found|session.*expired|heartbeat/i.test(lower)) {
        return t('errors.viewerSessionEnded');
    }
    if (/multipart|file field is required/i.test(lower)) {
        return t('errors.chooseFile');
    }
    if (/title.*(required|empty)|case title is required/i.test(lower)) {
        return t('errors.titleRequired');
    }
    if (/browser preview/i.test(lower)) {
        return t('errors.browserPreviewUnavailable');
    }
    if (/cannot be opened in full slicer|file type cannot/i.test(lower)) {
        return t('errors.fileTypeNotSupported');
    }
    if (/couldn't update people|could not update people/i.test(lower)) {
        return t('errors.peopleSaveFailed');
    }
    if (/directus|collection |queried in|invalid payload|unknown field|filter\[|case_directus|INTERNAL_SERVER/i.test(lower)) {
        return fallback;
    }

    if (text && text.length <= 140 && !/[`{}[\]<>]|_\w+_|\.\w+\./.test(text)) {
        return text;
    }

    return fallback;
}

export async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

/**
 * The browser's own text for an API error with a key (backend utils/errors.js fromKey): the
 * catalog's `api.<key>`, filled in with the error's `vars`. A `field` var is itself a key (a
 * field's name, e.g. 'workflow.fields.name') and is translated too. Null when the catalog
 * doesn't have the key yet; the server's English message is used then.
 */
export function apiErrorText(error) {
    const key = typeof error?.key === 'string' ? `api.${error.key}` : null;
    if (!key) return null;
    const vars = { ...(error.vars || {}) };
    if (typeof vars.field === 'string') vars.field = t(`api.${vars.field}`);
    const text = t(key, vars);
    return text === key ? null : text;
}

export function apiError(response, data, fallback, { friendly = false } = {}) {
    const raw = data?.error?.message || data?.message || '';
    const text = typeof raw === 'string' ? raw : '';
    const code = data?.error?.code || null;
    const message = apiErrorText(data?.error) || (friendly
        ? friendlyCasesError(text, fallback, response.status, code)
        : (text || fallback || `Request failed (${response.status})`));
    const err = new Error(message);
    err.status = response.status;
    err.code = code;
    err.rawMessage = text;
    err.payload = data;
    return err;
}

export async function parseApiResponse(response, fallback, options) {
    const data = await readJson(response);
    if (!response.ok) throw apiError(response, data, fallback, options);
    return data;
}

/**
 * Call the backend: `path` like '/api/workflows', `body` sent as JSON. Resolves the parsed
 * body (null for 204), or throws apiError (with { friendly } as for parseApiResponse).
 */
export async function apiRequest(path, { method = 'GET', body, fallback, friendly = false } = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        method,
        credentials: 'include',
        cache: 'no-store',
        ...(body === undefined ? {}
            : body instanceof FormData ? { body }
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 204) return null;
    return parseApiResponse(response, fallback, { friendly });
}
