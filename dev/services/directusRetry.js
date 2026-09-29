/**
 * Wraps a Directus save operation so that if the session has expired, the app shows the
 * reconnect dialog and retries automatically on success. The in-memory data is never lost —
 * saveFn is called again with the same closure state after the user reconnects.
 *
 * Rejects if the user cancels the reconnect dialog (caller should handle gracefully, e.g. keep
 * the form open so they can try again).
 */
export function saveWithDirectusReconnect(saveFn) {
    return Promise.resolve().then(() => saveFn()).catch(err => {
        if (err.code !== 'DIRECTUS_SESSION_EXPIRED' && err.code !== 'DIRECTUS_SESSION_REQUIRED') {
            throw err;
        }
        return new Promise((resolve, reject) => {
            function onRestored() {
                cleanup();
                Promise.resolve().then(() => saveFn()).then(resolve, reject);
            }
            function onCancelled() {
                cleanup();
                reject(err);
            }
            function cleanup() {
                window.removeEventListener('directus-session-restored', onRestored);
                window.removeEventListener('directus-session-reconnect-cancelled', onCancelled);
            }
            window.addEventListener('directus-session-restored', onRestored, { once: true });
            window.addEventListener('directus-session-reconnect-cancelled', onCancelled, { once: true });
        });
    });
}
