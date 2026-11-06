/**
 * Keycloak's sign-in page in a popup window, so the page underneath (and any unsaved
 * work) stays put. Used for re-sign-in, starting procedure mode and changing the
 * password. The backend's popup callback posts { type: 'slicerhub:signed-in', ok, code }
 * to this window and closes itself.
 *
 * Must be called from a click handler, so popup blockers allow it.
 */

const MESSAGE_TYPE = 'slicerhub:signed-in';

/**
 * @param {Record<string,string>} params extra query for /api/auth/login/start
 *   (e.g. { action: 'password' } or { procedure: '8', ack: '1' })
 * @returns {Promise<{ ok: boolean, code: string|null }>} resolves when the popup answers
 *   or is closed (code 'popup_closed'); rejects with Error('popup-blocked').
 */
export function openKeycloakPopup(params = {}) {
    const query = new URLSearchParams({ popup: '1', returnTo: '/', ...params });
    const popup = window.open(`/api/auth/login/start?${query}`, 'slicerhub-signin', 'popup,width=480,height=720');
    if (!popup) return Promise.reject(new Error('popup-blocked'));

    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            window.removeEventListener('message', onMessage);
            clearInterval(closedPoll);
            resolve(result);
        };
        const onMessage = (event) => {
            if (event.origin !== window.location.origin || event.data?.type !== MESSAGE_TYPE) return;
            finish({ ok: event.data.ok === true, code: event.data.code || null });
        };
        window.addEventListener('message', onMessage);
        // Closed without finishing (e.g. the person closed the window).
        const closedPoll = setInterval(() => {
            // Give a just-posted message a moment to arrive before calling it closed.
            if (popup.closed) setTimeout(() => finish({ ok: false, code: 'popup_closed' }), 300);
        }, 500);
    });
}
