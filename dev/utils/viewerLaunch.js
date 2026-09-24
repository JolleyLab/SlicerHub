/**
 * Shared viewer launch helpers for Trame and Full Slicer (local now, Vast/remote later).
 */

import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';
import { resolveTramePageUrl } from './trameViewerUrl.js';

export const VIEWER_KINDS = Object.freeze({
    TRAME: 'trame',
    SLICER_GUI: 'slicer-gui',
    SLICERWEB: 'slicerweb'
});

export const VIEWER_SESSION_SCOPES = Object.freeze({
    PROJECT: 'project',
    DIRECTUS: 'directus',
    SHARE: 'share'
});

/** Soft keeps runtime warm; hard destroys it. Soft is Full Slicer only for now. */
export const VIEWER_RELEASE_MODES = Object.freeze({
    SOFT: 'soft',
    HARD: 'hard'
});

export function viewerSupportsSoftRelease(kind) {
    return kind === VIEWER_KINDS.SLICER_GUI;
}

export function defaultReleaseModeForClose(kind) {
    return viewerSupportsSoftRelease(kind)
        ? VIEWER_RELEASE_MODES.SOFT
        : VIEWER_RELEASE_MODES.HARD;
}

function slicerGuiEndpoints(base, { reconnect = false, status = false } = {}) {
    const isProjectGpu = base.includes('/gpu');
    return {
        baseUrl: base,
        heartbeatUrl: `${base}/full-slicer-heartbeat`,
        stopUrl: isProjectGpu ? `${base}/stop-full-slicer` : `${base}/full-slicer-stop`,
        reconnectUrl: reconnect ? `${base}/reconnect-full-slicer` : null,
        statusUrl: status ? `${base}/full-slicer-status` : null
    };
}

/**
 * Heartbeat / stop / status URLs for a viewer session.
 * Cases use sessionScope=directus (no project id).
 */
export function getViewerSessionEndpoints({
    kind,
    projectId = null,
    sessionScope = VIEWER_SESSION_SCOPES.PROJECT,
    shareToken = null,
    apiUrl = API_URL
} = {}) {
    if (kind === VIEWER_KINDS.SLICER_GUI) {
        if (sessionScope === VIEWER_SESSION_SCOPES.DIRECTUS) {
            return slicerGuiEndpoints(`${apiUrl}/api/directus`, { status: true });
        }
        if (sessionScope === VIEWER_SESSION_SCOPES.SHARE) {
            if (!shareToken) {
                throw new Error('shareToken is required for share Full Slicer session endpoints');
            }
            return slicerGuiEndpoints(
                `${apiUrl}/api/share-links/${encodeURIComponent(shareToken)}`
            );
        }
        if (!projectId) {
            throw new Error('projectId is required for Full Slicer session endpoints');
        }
        return slicerGuiEndpoints(
            `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/gpu`,
            { reconnect: true, status: true }
        );
    }

    return {
        baseUrl: `${apiUrl}/api/containers`,
        heartbeatUrl: `${apiUrl}/api/containers/heartbeat`,
        stopUrl: `${apiUrl}/api/containers/stop`
    };
}

export function buildViewerStopBody({
    kind,
    sessionToken,
    projectId = null,
    mode = null,
    seatId = null
} = {}) {
    const body = {};
    if (sessionToken) body.sessionToken = sessionToken;
    if (kind === VIEWER_KINDS.TRAME && projectId) {
        body.projectId = projectId;
    }
    if (kind === VIEWER_KINDS.SLICER_GUI && seatId != null && seatId !== '') {
        body.seatId = Number(seatId);
    }
    const releaseMode = mode || defaultReleaseModeForClose(kind);
    if (viewerSupportsSoftRelease(kind)) {
        body.mode = releaseMode;
    }
    return body;
}

/**
 * Full Slicer loader URL (iframe embed or standalone tab).
 * embed=true → parent page owns heartbeat/stop.
 */
export function buildSlicerGuiLoaderUrl({
    projectId,
    fileId,
    fileName = '',
    vncPath = '',
    sessionToken = '',
    seatId = null,
    shareToken = '',
    sessionScope = '',
    simplified = false,
    embed = false,
    quick = false,
    baseHref = window.location.href
} = {}) {
    const loader = new URL(
        resolveTramePageUrl('/slicer-gui-loader.html'),
        baseHref
    );
    if (projectId != null && projectId !== '') {
        loader.searchParams.set('projectId', String(projectId));
    }
    if (fileId != null && fileId !== '') {
        loader.searchParams.set('fileId', String(fileId));
    }
    if (fileName) {
        loader.searchParams.set('fileName', fileName);
    }
    if (
        sessionScope === VIEWER_SESSION_SCOPES.DIRECTUS
        || sessionScope === VIEWER_SESSION_SCOPES.SHARE
    ) {
        loader.searchParams.set('sessionScope', sessionScope);
    }
    if (simplified) {
        loader.searchParams.set('simplified', '1');
    }
    if (embed) {
        loader.searchParams.set('embed', '1');
    }
    if (quick) {
        loader.searchParams.set('quick', '1');
    }
    if (sessionToken) {
        loader.searchParams.set('sessionToken', sessionToken);
    }
    if (seatId != null && seatId !== '') {
        loader.searchParams.set('seatId', String(seatId));
    }
    if (shareToken) {
        loader.searchParams.set('shareToken', String(shareToken));
    }

    const rawVnc = vncPath || '/slicer-gui/slicer-vnc.html?path=slicer-gui/websockify&autoconnect=true&scale=true';
    let vncParam = rawVnc;
    try {
        const parsed = new URL(rawVnc, baseHref);
        const vncPage = parsed.pathname.split('/').pop() || '';
        if (vncPage === 'vnc.html' || vncPage === 'vnc_lite.html') {
            parsed.pathname = parsed.pathname.replace(/\/(?:vnc_lite|vnc)\.html$/, '/slicer-vnc.html');
        }
        parsed.pathname = parsed.pathname.replace(/(?:slicer-)+slicer-vnc\.html$/, 'slicer-vnc.html');
        parsed.pathname = parsed.pathname.replace(/slicer-slicer-vnc\.html$/, 'slicer-vnc.html');
        if (!parsed.searchParams.get('path')) {
            const parts = parsed.pathname.split('/').filter(Boolean);
            if (parts[0] === 'slicer-gui') {
                const prefixParts = parts.slice(0, -1);
                if (prefixParts.length) {
                    parsed.searchParams.set('path', `${prefixParts.join('/')}/websockify`);
                }
            }
        }
        parsed.searchParams.set('autoconnect', parsed.searchParams.get('autoconnect') || 'true');
        parsed.searchParams.set('scale', 'true');
        parsed.searchParams.delete('resize');
        parsed.searchParams.set('quality', parsed.searchParams.get('quality') || '9');
        parsed.searchParams.delete('reconnect');
        parsed.searchParams.delete('reconnect_delay');
        vncParam = parsed.pathname + parsed.search;
    } catch (_) {
        /* keep as-is */
    }
    loader.searchParams.set('vnc', vncParam);
    return loader.href;
}

/** In-browser SlicerWeb build, served same-origin by nginx (see scripts/fetch-slicerweb.*). */
export function buildSlicerWebUrl({ layout = 'FourUp' } = {}) {
    return `/slicerweb/?layout=${encodeURIComponent(layout)}&sample=`;
}

export function viewerDisplayName(kind, { simplified = false } = {}) {
    if (kind === VIEWER_KINDS.SLICERWEB) return t('viewers.slicerWeb');
    if (kind === VIEWER_KINDS.SLICER_GUI) {
        return simplified ? t('viewers.simplified') : t('viewers.fullSlicer');
    }
    return t('viewers.trame');
}
