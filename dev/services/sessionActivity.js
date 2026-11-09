/**
 * Real use, for the session idle timeout.
 *
 * Only real use keeps a session alive: keys, pointer, wheel and touch — in the page and
 * inside same-origin viewer frames (Slicer Web, Full Slicer's noVNC, Trame), which the
 * old timer couldn't see. Background polling and heartbeats don't count.
 *
 *   - activity is reported to the server (POST /api/auth/activity) at most once a minute;
 *   - after `idleMinutes` with none in this tab, onIdle() is called. The app then asks
 *     the server, which counts use in every tab; if the session is idle there too, the
 *     page is hidden behind the sign-in dialog (unsaved work stays in memory);
 *   - in procedure mode there is no idle timeout (setIdleExempt(true)).
 *
 * docs/redirect-login-and-sessions-design.md ("Normal sessions").
 */

const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
const PING_EVERY_MS = 60 * 1000;
const FRAME_SCAN_MS = 15 * 1000;
const IDLE_CHECK_MS = 15 * 1000;

let state = null;

function onActivity() {
    if (!state) return;
    const now = Date.now();
    state.lastActivity = now;
    if (now - state.lastPing >= PING_EVERY_MS) {
        state.lastPing = now;
        // keepalive: still sent if the page is being closed
        fetch('/api/auth/activity', { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
    }
}

function listen(target) {
    if (!target || state.listened.has(target)) return;
    state.listened.add(target);
    for (const type of EVENTS) target.addEventListener(type, onActivity, { capture: true, passive: true });
}

/** Every iframe in a document, including those inside open shadow roots. */
function collectFrames(root, out) {
    for (const el of root.querySelectorAll('*')) {
        if (el.tagName === 'IFRAME') out.push(el);
        if (el.shadowRoot) collectFrames(el.shadowRoot, out);
    }
    return out;
}

/** Attach to same-origin frames (and frames within them, e.g. the Full Slicer loader). */
function scanFrames(doc = document, depth = 0) {
    if (!state || depth > 3) return;
    for (const frame of collectFrames(doc, [])) {
        let inner = null;
        try { inner = frame.contentDocument; } catch { inner = null; } // cross-origin: not visible
        if (!inner) continue;
        listen(inner);
        scanFrames(inner, depth + 1);
    }
}

/**
 * @param {{ idleMinutes: number, onIdle: () => void }} options
 */
export function startActivityTracking({ idleMinutes, onIdle }) {
    stopActivityTracking();
    state = {
        lastActivity: Date.now(),
        lastPing: Date.now(), // signing in just counted as activity
        idleMs: Math.max(1, Number(idleMinutes) || 30) * 60 * 1000,
        onIdle,
        exempt: false,
        listened: new WeakSet(),
        timers: [],
    };
    listen(document);
    scanFrames();
    state.timers.push(setInterval(() => scanFrames(), FRAME_SCAN_MS));
    state.timers.push(setInterval(() => {
        if (!state || state.exempt) return;
        if (Date.now() - state.lastActivity >= state.idleMs) {
            const cb = state.onIdle;
            state.lastActivity = Date.now(); // fire once per idle period
            cb?.();
        }
    }, IDLE_CHECK_MS));
}

export function stopActivityTracking() {
    if (!state) return;
    state.timers.forEach(clearInterval);
    // Listeners on frame documents (tracked in a WeakSet) are left; they no-op without state.
    for (const type of EVENTS) document.removeEventListener(type, onActivity, { capture: true });
    state = null;
}

/** Procedure mode: no idle timeout while true. */
export function setIdleExempt(exempt) {
    if (state) {
        state.exempt = Boolean(exempt);
        state.lastActivity = Date.now();
    }
}

/** Call onIdle again after `ms` unless there is activity first. */
export function recheckIdleIn(ms) {
    if (state) state.lastActivity = Date.now() - state.idleMs + ms;
}

/** Treat now as activity (e.g. right after signing in again). */
export function markActive() {
    if (state) {
        state.lastActivity = Date.now();
        state.lastPing = Date.now();
    }
}
