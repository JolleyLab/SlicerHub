/**
 * Shared viewer launch helpers for Trame and Full Slicer (local now, Vast/remote later).
 */

import { API_URL } from '../config.js';
import { resolveTramePageUrl } from './trameViewerUrl.js';

export const VIEWER_KINDS = Object.freeze({
    TRAME: 'trame',
    SLICER_GUI: 'slicer-gui'
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

/**
 * Heartbeat/stop endpoints for a viewer kind.
 * Remote Full Slicer (Vast) can reuse the same shape with different URL builders later.
 * Directus PoC uses project-less local Full Slicer routes under /api/directus.
 */
export function getViewerSessionEndpoints({
    kind,
    projectId = null,
    sessionScope = 'project',
    apiUrl = API_URL
} = {}) {
    if (kind === VIEWER_KINDS.SLICER_GUI) {
        if (sessionScope === 'directus') {
            const base = `${apiUrl}/api/directus`;
            return {
                baseUrl: base,
                heartbeatUrl: `${base}/full-slicer-heartbeat`,
                stopUrl: `${base}/full-slicer-stop`,
                reconnectUrl: null,
                statusUrl: null
            };
        }
        if (!projectId) {
            throw new Error('projectId is required for Full Slicer session endpoints');
        }
        const base = `${apiUrl}/api/projects/${encodeURIComponent(projectId)}/gpu`;
        return {
            baseUrl: base,
            heartbeatUrl: `${base}/full-slicer-heartbeat`,
            stopUrl: `${base}/stop-full-slicer`,
            reconnectUrl: `${base}/reconnect-full-slicer`,
            statusUrl: `${base}/full-slicer-status`
        };
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
 * Build the Full Slicer loader URL (works in iframe embed or standalone tab).
 * Pass embed=true when parenting the loader; parent owns session release then.
 */
export function buildSlicerGuiLoaderUrl({
    projectId,
    fileId,
    fileName = '',
    vncPath = '',
    sessionToken = '',
    seatId = null,
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

    const rawVnc = vncPath || '/slicer-gui/vnc_lite.html?path=slicer-gui/websockify&autoconnect=true&scale=true';
    let vncParam = rawVnc;
    try {
        const parsed = new URL(rawVnc, baseHref);
        // Ensure websocket path stays under the /slicer-gui/... prefix when proxied.
        if (!parsed.searchParams.get('path')) {
            const parts = parsed.pathname.split('/').filter(Boolean);
            // ["slicer-gui", "user-1-seat1", "vnc_lite.html"] or ["slicer-gui", "vnc_lite.html"]
            if (parts[0] === 'slicer-gui') {
                const prefixParts = parts.slice(0, -1);
                if (prefixParts.length) {
                    parsed.searchParams.set('path', `${prefixParts.join('/')}/websockify`);
                }
            }
        }
        parsed.searchParams.set('autoconnect', parsed.searchParams.get('autoconnect') || 'true');
        parsed.searchParams.set('scale', 'true');
        // vnc_lite ignores these full-UI flags.
        parsed.searchParams.delete('resize');
        parsed.searchParams.delete('reconnect');
        parsed.searchParams.delete('reconnect_delay');
        vncParam = parsed.pathname + parsed.search;
    } catch (_) {
        /* keep as-is */
    }
    loader.searchParams.set('vnc', vncParam);
    return loader.href;
}

export function viewerDisplayName(kind, { simplified = false } = {}) {
    if (kind === VIEWER_KINDS.SLICER_GUI) {
        return simplified ? 'Simplified viewer' : 'Full Slicer';
    }
    return 'Trame';
}
