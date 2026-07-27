import { attachViewerSessionLifecycle } from './utils/viewerSessionLifecycle.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    getViewerSessionEndpoints
} from './utils/viewerLaunch.js';

const params = new URLSearchParams(window.location.search);
let projectId = params.get('projectId') || '';
let fileName = params.get('fileName') || '';
const simplified = params.get('simplified') === '1';
const embedded = params.get('embed') === '1';
const quick = params.get('quick') === '1';
let sessionToken = params.get('sessionToken') || '';
const fileId = params.get('fileId') || '';
let vncPath = params.get('vnc') || '/slicer-gui/vnc.html?autoconnect=true&resize=scale';

const splash = document.getElementById('splash');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const viewer = document.getElementById('viewer');

function sessionEndpoints() {
    if (!projectId) return null;
    return getViewerSessionEndpoints({
        kind: VIEWER_KINDS.SLICER_GUI,
        projectId,
        apiUrl: ''
    });
}

function setSplashMessage(heading, detail) {
    title.textContent = heading;
    subtitle.textContent = detail || '';
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
const maxWaitMs = quick ? 15000 : 90000;
const minSplashMs = quick ? 150 : 900;
let sawBusy = false;
let revealed = false;
let lifecycle = null;

function reveal() {
    if (revealed) return;
    revealed = true;
    viewer.classList.add('visible');
    splash.classList.add('hidden');
}

async function heartbeatSession(token) {
    const endpoints = sessionEndpoints();
    if (!endpoints) return false;
    const response = await fetch(endpoints.heartbeatUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: token })
    });
    return response.ok;
}

async function reconnectSession() {
    const endpoints = sessionEndpoints();
    if (!endpoints) return false;
    setSplashMessage('Reconnecting…', 'Restoring your Full Slicer session');
    const response = await fetch(endpoints.reconnectUrl, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...(fileId ? { fileId: Number(fileId) } : {}),
            useSimplifiedViewer: simplified
        })
    });
    if (!response.ok) {
        return false;
    }
    const data = await response.json();
    sessionToken = data.sessionToken || sessionToken;
    if (data.vncPath) {
        vncPath = data.vncPath;
    }
    if (data.fileName && !fileName) {
        // Prefer an existing display title from the opener; fall back to server file name.
        fileName = data.fileName;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('sessionToken', sessionToken);
    if (data.vncPath) {
        url.searchParams.set('vnc', data.vncPath);
    }
    history.replaceState(null, '', url);
    return true;
}

async function ensureViewerSession() {
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
    // When embedded in the app iframe, the parent page owns heartbeat/stop.
    const endpoints = sessionEndpoints();
    if (embedded || !endpoints || !sessionToken) {
        return;
    }
    lifecycle?.stopHeartbeat?.();
    lifecycle = attachViewerSessionLifecycle({
        sessionToken,
        heartbeatUrl: endpoints.heartbeatUrl,
        stopUrl: endpoints.stopUrl,
        releaseOnUnload: true,
        releaseMode: VIEWER_RELEASE_MODES.SOFT,
        onHeartbeatFailed: async () => {
            const ok = await reconnectSession();
            if (ok) {
                startLifecycle();
            }
        }
    });
}

function notifyParentActivity() {
    if (!embedded || window.parent === window) return;
    try {
        window.parent.postMessage({ type: 'slicer-viewer-activity' }, window.location.origin);
    } catch {
        /* ignore */
    }
}

function installEmbedActivityBridge() {
    if (!embedded) return;
    const onActivity = () => notifyParentActivity();
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((eventName) => {
        window.addEventListener(eventName, onActivity, { passive: true, capture: true });
    });
    viewer.addEventListener('load', () => {
        try {
            const doc = viewer.contentDocument;
            if (!doc) return;
            ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((eventName) => {
                doc.addEventListener(eventName, onActivity, { passive: true, capture: true });
            });
        } catch {
            /* cross-origin VNC path */
        }
        notifyParentActivity();
    });
}

function loadViewer() {
    viewer.src = vncPath;
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
    if (!endpoints) {
        if (Date.now() - startedAt > 3500) reveal();
        return;
    }
    try {
        const response = await fetch(endpoints.statusUrl, {
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            if (Date.now() - startedAt > 5000) reveal();
            return;
        }
        const data = await response.json();
        if (data.busy) {
            sawBusy = true;
            return;
        }
        const waitedLongEnough = Date.now() - startedAt >= minSplashMs;
        if ((sawBusy || Date.now() - startedAt > 4000) && waitedLongEnough) {
            reveal();
        }
    } catch {
        if (Date.now() - startedAt > 5000) reveal();
    }
}

async function init() {
    const ready = await ensureViewerSession();
    if (!ready) {
        setSplashMessage(
            'Unable to connect',
            'Return to My Projects and open Full Slicer again.'
        );
        return;
    }
    installEmbedActivityBridge();
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
