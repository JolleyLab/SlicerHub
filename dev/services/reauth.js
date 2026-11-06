/**
 * "Your session ended — sign in to continue", shared by every caller.
 *
 * Any code that gets a 401 from the API (the fetch wrapper in authFetch.js, the TUS
 * uploader) calls requestReauth(). The app shell registers the handler that shows the
 * sign-in dialog. Concurrent callers share one prompt; when the person signs in again,
 * every waiting request is retried. Nothing on the page is reloaded, so unsaved work
 * (e.g. a scene in the viewer) stays in memory.
 *
 * docs/redirect-login-and-sessions-design.md ("Session ended mid-work").
 */

let handler = null;
let pending = null;

/**
 * @param {(reason: string) => Promise<void>} fn resolves when signed in again,
 *        rejects if the person signs out instead.
 */
export function setReauthHandler(fn) {
    handler = fn;
}

export function clearReauthHandler() {
    handler = null;
    pending = null;
}

export function isReauthAvailable() {
    return typeof handler === 'function';
}

/**
 * @param {'expired'|'idle'|'max-age'} reason why the session ended (for the wording)
 * @returns {Promise<void>} resolves after a successful sign-in
 */
export function requestReauth(reason = 'expired') {
    if (!handler) return Promise.reject(new Error('Not signed in'));
    if (!pending) {
        pending = Promise.resolve()
            .then(() => handler(reason))
            .finally(() => { pending = null; });
    }
    return pending;
}

/** The server's error code → the reason shown in the dialog. */
export function reasonFromCode(code) {
    if (code === 'SESSION_IDLE') return 'idle';
    if (code === 'SESSION_MAX_AGE') return 'max-age';
    return 'expired';
}
