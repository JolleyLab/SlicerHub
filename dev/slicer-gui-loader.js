import { attachViewerSessionLifecycle } from './utils/viewerSessionLifecycle.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    VIEWER_SESSION_SCOPES,
    getViewerSessionEndpoints
} from './utils/viewerLaunch.js';

const params = new URLSearchParams(window.location.search);
let projectId = params.get('projectId') || '';
const shareToken = params.get('shareToken') || '';
const sessionScope = params.get('sessionScope') || '';
let fileName = params.get('fileName') || '';
const simplified = params.get('simplified') === '1';
const embedded = params.get('embed') === '1';
const quick = params.get('quick') === '1';
let sessionToken = params.get('sessionToken') || '';
let seatId = params.get('seatId') || '';
const fileId = params.get('fileId') || '';
let vncPath = params.get('vnc') || '/slicer-gui/slicer-vnc.html?path=slicer-gui/websockify&autoconnect=true&scale=true';
let sawVncConnected = false;

const splash = document.getElementById('splash');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const reconnectBtn = document.getElementById('reconnect');
const viewer = document.getElementById('viewer');

function sessionEndpoints() {
    if (shareToken || sessionScope === VIEWER_SESSION_SCOPES.SHARE) {
        return getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.SHARE,
            shareToken,
            apiUrl: ''
        });
    }
    if (sessionScope === VIEWER_SESSION_SCOPES.CASES) {
        return getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: ''
        });
    }
    if (sessionScope === VIEWER_SESSION_SCOPES.DIRECTUS) {
        return getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS,
            apiUrl: ''
        });
    }
    if (!projectId) return null;
    return getViewerSessionEndpoints({
        kind: VIEWER_KINDS.SLICER_GUI,
        projectId,
        apiUrl: ''
    });
}

function setSplashMessage(heading, detail, { error = false } = {}) {
    title.textContent = heading;
    subtitle.textContent = detail || '';
    splash.classList.toggle('error', Boolean(error));
    splash.classList.remove('hidden', 'fading');
}

const BUSY_SPLASH = {
    queued: ['Opening viewer…', 'Waiting for the desktop…'],
    opening: ['Opening viewer…', 'Setting up the desktop…'],
    loading: ['Loading scene…', fileName ? `Loading ${fileName}` : 'Large scenes can take a minute…'],
    preparing: ['Preparing viewer…', 'Getting everything ready for this project…']
};

function applyBusySplash(message) {
    const key = String(message || '').toLowerCase();
    const pair = BUSY_SPLASH[key] || BUSY_SPLASH.loading;
    setSplashMessage(pair[0], pair[1]);
    notifyParent('slicer-viewer-loading', { heading: pair[0], detail: pair[1] });
}

if (quick) {
    setSplashMessage(
        simplified ? 'Reconnecting…' : 'Reconnecting to Full Slicer…',
        fileName ? fileName : 'Restoring your session'
    );
} else if (fileName) {
    setSplashMessage(
        simplified ? 'Opening simplified viewer…' : 'Opening Full Slicer…',
        'Loading ' + fileName
    );
} else if (simplified) {
    setSplashMessage('Opening simplified viewer…');
}

const startedAt = Date.now();
const maxWaitMs = quick ? 15000 : 120000;
const minSplashMs = quick ? 150 : 600;
let sawBusy = false;
let revealed = false;
let lifecycle = null;
let vncWatchTimer = null;
let reconnecting = false;
let disconnectNotified = false;

function reveal() {
    if (revealed) return;
    revealed = true;
    disconnectNotified = false;
    notifyParent('slicer-viewer-ready');
    viewer.classList.add('visible');
    splash.classList.add('fading');
    splash.classList.remove('error');
    setTimeout(() => {
        splash.classList.add('hidden');
    }, 380);
    // When we saw a real busy→idle cycle, check whether the file load actually
    // succeeded. slicer_session.py writes .load-result.json before clearing busy,
    // so the result is already on disk by the time we reveal.
    if (sawBusy) {
        checkLoadResult();
    }
}

async function checkLoadResult() {
    const endpoints = sessionEndpoints();
    if (!endpoints?.statusUrl) return;
    try {
        const statusUrl = new URL(endpoints.statusUrl, window.location.origin);
        if (seatId) statusUrl.searchParams.set('seatId', String(seatId));
        const response = await fetch(statusUrl.toString(), { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        const lr = data.loadResult;
        if (!lr || lr.success !== false) return;
        // Only act if the result was written after this loader session started.
        const updatedAt = lr.updatedAt ? new Date(lr.updatedAt).getTime() : 0;
        if (updatedAt < startedAt) return;
        notifyParent('slicer-viewer-load-failed', { error: lr.error || 'load failed' });
    } catch {
        // ignore — non-fatal
    }
}

function hideViewer() {
    viewer.classList.remove('visible');
}

function readVncStatusText() {
    try {
        // Only the live status node — never body/script text (false positives).
        return (viewer.contentDocument?.getElementById('status')?.textContent || '').trim();
    } catch {
        return '';
    }
}

function isVncConnectedStatus(text) {
    return /^connected\b/i.test(String(text || '').trim());
}

function isVncDisconnectedStatus(text) {
    const lower = String(text || '').trim().toLowerCase();
    if (!lower) return false;
    return (
        lower === 'disconnected'
        || lower.startsWith('disconnected')
        || lower.includes('connection is closed')
        || lower.includes('failed to connect')
    );
}

async function heartbeatSession(token) {
    const endpoints = sessionEndpoints();
    if (!endpoints) return false;
    const body = { sessionToken: token };
    if (seatId) body.seatId = Number(seatId);
    const response = await fetch(endpoints.heartbeatUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.ok;
}

async function reconnectSession() {
    const endpoints = sessionEndpoints();
    if (!endpoints?.reconnectUrl) return false;
    setSplashMessage('Reconnecting…', 'Restoring your Full Slicer session');
    const body = {
        ...(fileId && Number(fileId) > 0 ? { fileId: Number(fileId) } : {}),
        useSimplifiedViewer: simplified
    };
    if (seatId) body.seatId = Number(seatId);
    const response = await fetch(endpoints.reconnectUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        return false;
    }
    const data = await response.json();
    sessionToken = data.sessionToken || sessionToken;
    if (data.seatId != null) {
        seatId = String(data.seatId);
    }
    if (data.vncPath) {
        vncPath = data.vncPath;
    }
    if (data.fileName && !fileName) {
        // Prefer an existing display title from the opener; fall back to server file name.
        fileName = data.fileName;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('sessionToken', sessionToken);
    if (seatId) {
        url.searchParams.set('seatId', seatId);
    }
    if (data.vncPath) {
        url.searchParams.set('vnc', data.vncPath);
    }
    history.replaceState(null, '', url);
    return true;
}

async function ensureViewerSession() {
    if (shareToken || sessionScope === VIEWER_SESSION_SCOPES.CASES || sessionScope === VIEWER_SESSION_SCOPES.DIRECTUS) {
        if (sessionToken && await heartbeatSession(sessionToken)) {
            return true;
        }
        return Boolean(sessionToken);
    }
    if (!projectId) {
        return true;
    }
    if (sessionToken && await heartbeatSession(sessionToken)) {
        return true;
    }
    if (!fileId && !sessionToken) {
        return false;
    }
    return reconnectSession();
}

function startLifecycle() {
    // When embedded in the app iframe, the parent page owns heartbeat/stop —
    // except share links, where the shell does not run Full Slicer heartbeats.
    const endpoints = sessionEndpoints();
    if ((embedded && !shareToken) || !endpoints || !sessionToken) {
        return;
    }
    lifecycle?.stopHeartbeat?.();
    lifecycle = attachViewerSessionLifecycle({
        sessionToken,
        heartbeatUrl: endpoints.heartbeatUrl,
        stopUrl: endpoints.stopUrl,
        releaseOnUnload: true,
        releaseMode: VIEWER_RELEASE_MODES.SOFT,
        heartbeatBody: (token) => ({
            sessionToken: token,
            ...(seatId ? { seatId: Number(seatId) } : {})
        }),
        onHeartbeatFailed: async () => {
            const ok = await reconnectSession();
            if (ok) {
                startLifecycle();
            }
        }
    });
}

function notifyParent(type, extra = {}) {
    if (!embedded || window.parent === window) return;
    try {
        window.parent.postMessage({ type, ...extra }, window.location.origin);
    } catch {
        /* ignore */
    }
}

function polishVncChrome() {
    try {
        const doc = viewer.contentDocument;
        if (!doc?.head) return;
        let style = doc.getElementById('slicer-web-vnc-chrome');
        if (!style) {
            style = doc.createElement('style');
            style.id = 'slicer-web-vnc-chrome';
            doc.head.appendChild(style);
        }
        // Hide leftover noVNC chrome.
        style.textContent = `
            #top_bar,
            #noVNC_control_bar_anchor,
            #noVNC_control_bar,
            #noVNC_control_bar_handle,
            #noVNC_control_bar_handle *,
            #noVNC_status,
            #noVNC_transition,
            .noVNC_panel,
            .noVNC_logo {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
                opacity: 0 !important;
            }
            html, body {
                margin: 0 !important;
                height: 100% !important;
                background: #090b14 !important;
                overscroll-behavior: none !important;
            }
            body { display: flex !important; flex-direction: column !important; }
            #screen, #noVNC_container, #noVNC_screen {
                flex: 1 1 auto !important;
                width: 100% !important;
                height: 100% !important;
                overflow: hidden !important;
                touch-action: none !important;
            }
        `;
    } catch {
        /* cross-origin */
    }
}

function notifyParentActivity() {
    notifyParent('slicer-viewer-activity');
}

function handleVncDisconnected() {
    if (reconnecting || disconnectNotified) return;
    disconnectNotified = true;
    revealed = false;
    hideViewer();
    setSplashMessage(
        'Viewer disconnected',
        'The remote desktop connection was lost. This can happen after the tab sleeps (common in Microsoft Edge).',
        { error: true }
    );
    notifyParent('slicer-viewer-disconnected');
}

async function reconnectViewer() {
    if (reconnecting) return;
    reconnecting = true;
    disconnectNotified = false;
    sawVncConnected = false;
    revealed = false;
    hideViewer();
    setSplashMessage('Reconnecting…', 'Restoring the viewer session');
    try {
        const ok = await ensureViewerSession();
        if (!ok) {
            setSplashMessage(
                'Unable to reconnect',
                'Return to My Projects and open the viewer again.',
                { error: true }
            );
            return;
        }
        startLifecycle();
        loadViewer({ forceReload: true });
        // Wait for a real Connected status before revealing.
        const deadline = Date.now() + 8000;
        const waitConnected = () => {
            const status = readVncStatusText();
            if (isVncConnectedStatus(status)) {
                sawVncConnected = true;
                reveal();
                notifyParentActivity();
                return;
            }
            if (Date.now() >= deadline) {
                if (isVncDisconnectedStatus(status)) {
                    handleVncDisconnected();
                } else {
                    // Still connecting — show the viewer anyway.
                    reveal();
                }
                return;
            }
            setTimeout(waitConnected, 250);
        };
        setTimeout(waitConnected, 300);
    } finally {
        reconnecting = false;
    }
}

function installVncDisconnectWatch() {
    if (vncWatchTimer) {
        clearInterval(vncWatchTimer);
    }
    // Only treat disconnect after we have seen Connected at least once.
    vncWatchTimer = setInterval(() => {
        if (!revealed || reconnecting || document.hidden) return;
        const status = readVncStatusText();
        if (isVncConnectedStatus(status)) {
            sawVncConnected = true;
            polishVncChrome();
            return;
        }
        if (sawVncConnected && isVncDisconnectedStatus(status)) {
            handleVncDisconnected();
        }
    }, 2000);
}

function installWakeHandlers() {
    const onWake = async () => {
        if (document.hidden) return;
        notifyParentActivity();
        if (sessionToken) {
            await heartbeatSession(sessionToken).catch(() => false);
        }
        // Avoid interrupting the first connect; only auto-recover after a known session.
        if (disconnectNotified || (sawVncConnected && isVncDisconnectedStatus(readVncStatusText()))) {
            await reconnectViewer();
        }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    reconnectBtn?.addEventListener('click', () => {
        reconnectViewer();
    });
}

function installEmbedActivityBridge() {
    if (!embedded) return;
    const onActivity = () => notifyParentActivity();
    // Block Ctrl/Meta+wheel browser zoom over the viewer.
    const onWheel = (event) => {
        onActivity();
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
        }
    };
    ['pointerdown', 'keydown', 'touchstart', 'mousemove'].forEach((eventName) => {
        window.addEventListener(eventName, onActivity, { passive: true, capture: true });
    });
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    viewer.addEventListener('load', () => {
        polishVncChrome();
        try {
            const doc = viewer.contentDocument;
            if (!doc) return;
            ['pointerdown', 'keydown', 'touchstart', 'mousemove'].forEach((eventName) => {
                doc.addEventListener(eventName, onActivity, { passive: true, capture: true });
            });
            doc.addEventListener('wheel', onWheel, { passive: false, capture: true });
        } catch {
            /* cross-origin VNC path */
        }
        notifyParentActivity();
    });
}

function loadViewer({ forceReload = false } = {}) {
    const next = vncPath;
    if (forceReload) {
        // Cache-bust so Edge does not keep a dead websocket page.
        const url = new URL(next, window.location.href);
        url.searchParams.set('_ts', String(Date.now()));
        viewer.src = url.pathname + url.search;
    } else {
        viewer.src = next;
    }
    viewer.addEventListener('load', () => {
        polishVncChrome();
        setTimeout(polishVncChrome, 400);
        setTimeout(polishVncChrome, 1200);
    }, { once: !forceReload });
    if (quick) {
        viewer.addEventListener('load', () => {
            if (Date.now() - startedAt >= minSplashMs) {
                reveal();
            } else {
                setTimeout(reveal, Math.max(0, minSplashMs - (Date.now() - startedAt)));
            }
        }, { once: true });
    }
}

async function checkStatus() {
    if (quick) {
        if (Date.now() - startedAt > 2500) reveal();
        return;
    }
    const endpoints = sessionEndpoints();
    if (!endpoints?.statusUrl) {
        if (Date.now() - startedAt > 8000) reveal();
        return;
    }
    try {
        const statusUrl = new URL(endpoints.statusUrl, window.location.origin);
        if (seatId) statusUrl.searchParams.set('seatId', String(seatId));
        const response = await fetch(statusUrl.toString(), {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            if (Date.now() - startedAt > 12000) reveal();
            return;
        }
        const data = await response.json();
        if (data.busy) {
            sawBusy = true;
            applyBusySplash(data.message);
            return;
        }
        const waitedLongEnough = Date.now() - startedAt >= minSplashMs;
        if (sawBusy && waitedLongEnough) {
            // After a busy→idle cycle, only reveal once a load result is present.
            // Between retries slicer_session.py briefly clears busy without writing
            // a result yet — revealing in that gap would skip the failure check.
            if (data.loadResult != null) {
                reveal();
            }
            // else: keep polling; result will appear when all retries are exhausted.
            return;
        }
        if (!sawBusy && Date.now() - startedAt > 10000 && waitedLongEnough) {
            reveal();
        }
    } catch {
        if (Date.now() - startedAt > 12000) reveal();
    }
}

async function init() {
    const ready = await ensureViewerSession();
    if (!ready) {
        setSplashMessage(
            'Unable to connect',
            'Return to My Projects and open Full Slicer again.',
            { error: true }
        );
        return;
    }
    installEmbedActivityBridge();
    installWakeHandlers();
    installVncDisconnectWatch();
    startLifecycle();
    loadViewer();

    const poll = setInterval(async () => {
        if (revealed) {
            clearInterval(poll);
            return;
        }
        if (Date.now() - startedAt > maxWaitMs) {
            reveal();
            clearInterval(poll);
            return;
        }
        await checkStatus();
    }, 400);

    checkStatus();
}

init();
