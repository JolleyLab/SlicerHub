import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEWER_KINDS,
    VIEWER_SESSION_SCOPES,
    getViewerSessionEndpoints,
} from '../../../dev/utils/viewerLaunch.js';

const BASE = 'http://example.com';

describe('getViewerSessionEndpoints — CASES scope', () => {
    it('heartbeat points at /api/cases/full-slicer-heartbeat', () => {
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: BASE,
        });
        assert.equal(heartbeatUrl, `${BASE}/api/cases/full-slicer-heartbeat`);
    });

    it('stop points at /api/cases/full-slicer-stop', () => {
        const { stopUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: BASE,
        });
        assert.equal(stopUrl, `${BASE}/api/cases/full-slicer-stop`);
    });

    it('status URL is provided', () => {
        const { statusUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: BASE,
        });
        assert.equal(statusUrl, `${BASE}/api/cases/full-slicer-status`);
    });

    it('does not include a reconnect URL (cases have no reconnect flow)', () => {
        const { reconnectUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: BASE,
        });
        assert.equal(reconnectUrl, null);
    });
});

describe('getViewerSessionEndpoints — DIRECTUS scope still works', () => {
    it('heartbeat still points at /api/directus/full-slicer-heartbeat', () => {
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS,
            apiUrl: BASE,
        });
        assert.equal(heartbeatUrl, `${BASE}/api/directus/full-slicer-heartbeat`);
    });
});

describe('getViewerSessionEndpoints — CASES vs DIRECTUS are distinct', () => {
    it('CASES and DIRECTUS produce different base URLs', () => {
        const cases = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.CASES,
            apiUrl: BASE,
        });
        const directus = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS,
            apiUrl: BASE,
        });
        assert.notEqual(cases.heartbeatUrl, directus.heartbeatUrl);
        assert.notEqual(cases.stopUrl, directus.stopUrl);
    });
});
