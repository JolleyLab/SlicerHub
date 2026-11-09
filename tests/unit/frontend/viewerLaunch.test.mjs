import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEWER_KINDS,
    VIEWER_SESSION_SCOPES,
    getViewerSessionEndpoints,
    buildSlicerGuiLoaderUrl,
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

describe('buildSlicerGuiLoaderUrl — the loader page learns its session scope', () => {
    // Without it, a case's Full Slicer loader can't find its status/heartbeat endpoints.
    it('carries sessionScope=cases for a case viewer', () => {
        const url = new URL(buildSlicerGuiLoaderUrl({
            fileId: 'f1', sessionToken: 't', sessionScope: VIEWER_SESSION_SCOPES.CASES, embed: true,
            baseHref: `${BASE}/`,
        }));
        assert.equal(url.searchParams.get('sessionScope'), 'cases');
    });

    it('leaves it out for a project viewer (found from projectId)', () => {
        const url = new URL(buildSlicerGuiLoaderUrl({ projectId: 3, fileId: 'f1', baseHref: `${BASE}/` }));
        assert.equal(url.searchParams.get('sessionScope'), null);
        assert.equal(url.searchParams.get('projectId'), '3');
    });

    it('there is no Directus scope any more', () => {
        assert.equal('DIRECTUS' in VIEWER_SESSION_SCOPES, false);
    });
});
