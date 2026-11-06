/**
 * Keeps work going when the session ends: wraps window.fetch so a 401 from our API
 * opens the sign-in dialog (reauth.js) and, once the person signs in again, retries the
 * request once — instead of every caller failing on its own.
 *
 * Installed by the app shell after sign-in, removed on sign-out.
 */

import { requestReauth, reasonFromCode } from './reauth.js';

/** Endpoints whose 401 means something else (signing out of an already-ended session). */
const NOT_HANDLED = [
    '/api/auth/logout',
];

let nativeFetch = null;
let onProcedureEnded = null;

function apiPath(input) {
    try {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
        if (url.origin !== window.location.origin) return null;
        return url.pathname.startsWith('/api/') ? url.pathname : null;
    } catch {
        return null;
    }
}

function canRetry(input, init) {
    // A streamed body can only be sent once.
    const body = init?.body;
    if (body && typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
    if (input instanceof Request && input.bodyUsed) return false;
    return true;
}

/**
 * @param {{ onProcedureModeEnded?: () => void }} options
 *   onProcedureModeEnded — procedure mode ran out: sign out instead of offering re-sign-in.
 */
export function installAuthFetch({ onProcedureModeEnded } = {}) {
    if (nativeFetch) return;
    nativeFetch = window.fetch.bind(window);
    onProcedureEnded = onProcedureModeEnded || null;

    window.fetch = async (input, init) => {
        const path = apiPath(input);
        const retryInput = input instanceof Request ? input.clone() : input;
        const res = await nativeFetch(input, init);
        if (res.status !== 401 || !path || NOT_HANDLED.includes(path)) return res;

        const body = await res.clone().json().catch(() => null);
        const code = body?.error?.code || null;
        if (code === 'PROCEDURE_MODE_ENDED') {
            onProcedureEnded?.();
            return res;
        }
        if (!canRetry(input, init)) return res;
        try {
            await requestReauth(reasonFromCode(code));
        } catch {
            return res; // they signed out instead
        }
        return nativeFetch(retryInput, init);
    };
}

export function uninstallAuthFetch() {
    if (!nativeFetch) return;
    window.fetch = nativeFetch;
    nativeFetch = null;
    onProcedureEnded = null;
}
