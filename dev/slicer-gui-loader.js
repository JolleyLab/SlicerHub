import { attachViewerSessionLifecycle } from './utils/viewerSessionLifecycle.js';

const params = new URLSearchParams(window.location.search);
let projectId = params.get('projectId') || '';
let fileName = params.get('fileName') || '';
const simplified = params.get('simplified') === '1';
let sessionToken = params.get('sessionToken') || '';
const fileId = params.get('fileId') || '';
let vncPath = params.get('vnc') || '/slicer-gui/vnc.html?autoconnect=true&resize=scale';

const splash = document.getElementById('splash');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const viewer = document.getElementById('viewer');

function setSplashMessage(heading, detail) {
    title.textContent = heading;
    subtitle.textContent = detail || '';
}

if (fileName) {
    setSplashMessage(
        simplified ? 'Opening simplified viewer…' : 'Opening Full Slicer…',
        'Loading ' + fileName
    );
} else if (simplified) {
    setSplashMessage('Opening simplified viewer…');
}

const startedAt = Date.now();
const maxWaitMs = 90000;
const minSplashMs = 900;
let sawBusy = false;
let revealed = false;
let lifecycle = null;

function reveal() {
    if (revealed) return;
    revealed = true;
    viewer.classList.add('visible');
    splash.classList.add('hidden');
}

function apiBase() {
    return '/api/projects/' + encodeURIComponent(projectId) + '/gpu';
}

async function heartbeatSession(token) {
    const response = await fetch(apiBase() + '/full-slicer-heartbeat', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: token })
    });
    return response.ok;
}

async function reconnectSession() {
    if (!projectId) return false;
    setSplashMessage('Reconnecting…', 'Restoring your Full Slicer session');
    const response = await fetch(apiBase() + '/reconnect-full-slicer', {
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
    if (data.fileName) {
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
    if (!projectId || !sessionToken) {
        return;
    }
    lifecycle?.stopHeartbeat?.();
    lifecycle = attachViewerSessionLifecycle({
        sessionToken,
        heartbeatUrl: apiBase() + '/full-slicer-heartbeat',
        stopUrl: apiBase() + '/stop-full-slicer',
        releaseOnUnload: true,
        onHeartbeatFailed: async () => {
            const ok = await reconnectSession();
            if (ok) {
                startLifecycle();
            }
        }
    });
}

function loadViewer() {
    viewer.src = vncPath;
}

async function checkStatus() {
    if (!projectId) {
        if (Date.now() - startedAt > 3500) reveal();
        return;
    }
    try {
        const response = await fetch(apiBase() + '/full-slicer-status', {
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
