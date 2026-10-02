import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeLocalSlicerViewerOptions,
    resolveSimplifiedViewerChoice,
    DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS
} from '../../../dev/utils/localSlicerViewerOptions.js';

describe('DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS', () => {
    it('defaults to no full slicer and no simplified viewer', () => {
        assert.equal(DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS.useFullSlicer, false);
        assert.equal(DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS.useSimplifiedViewer, false);
    });
});

describe('normalizeLocalSlicerViewerOptions', () => {
    it('returns defaults for empty input', () => {
        assert.deepEqual(normalizeLocalSlicerViewerOptions({}), { useFullSlicer: false, useSimplifiedViewer: false });
    });

    it('returns defaults for no input', () => {
        assert.deepEqual(normalizeLocalSlicerViewerOptions(), { useFullSlicer: false, useSimplifiedViewer: false });
    });

    it('sets useFullSlicer true when passed true', () => {
        assert.equal(normalizeLocalSlicerViewerOptions({ useFullSlicer: true }).useFullSlicer, true);
    });

    it('clears useSimplifiedViewer when useFullSlicer is false', () => {
        const result = normalizeLocalSlicerViewerOptions({ useFullSlicer: false, useSimplifiedViewer: true });
        assert.equal(result.useFullSlicer, false);
        assert.equal(result.useSimplifiedViewer, false);
    });

    it('allows useSimplifiedViewer only when useFullSlicer is true', () => {
        const result = normalizeLocalSlicerViewerOptions({ useFullSlicer: true, useSimplifiedViewer: true });
        assert.equal(result.useFullSlicer, true);
        assert.equal(result.useSimplifiedViewer, true);
    });

    it('treats truthy non-boolean as false (strict === true check)', () => {
        assert.equal(normalizeLocalSlicerViewerOptions({ useFullSlicer: 1 }).useFullSlicer, false);
    });

    it('treats falsy non-boolean as false', () => {
        assert.equal(normalizeLocalSlicerViewerOptions({ useFullSlicer: 0 }).useFullSlicer, false);
    });
});

describe('accountDefaultViewer logic (derived from normalizeLocalSlicerViewerOptions)', () => {
    function accountDefaultViewer(input) {
        const { useFullSlicer, useSimplifiedViewer } = normalizeLocalSlicerViewerOptions(input);
        if (useFullSlicer && useSimplifiedViewer) return 'simplified';
        if (useFullSlicer) return 'full';
        return 'web';
    }

    it('defaults to web when no preferences saved', () => {
        assert.equal(accountDefaultViewer({}), 'web');
    });

    it('returns full when useFullSlicer is true and simplified is false', () => {
        assert.equal(accountDefaultViewer({ useFullSlicer: true, useSimplifiedViewer: false }), 'full');
    });

    it('returns simplified when both are true', () => {
        assert.equal(accountDefaultViewer({ useFullSlicer: true, useSimplifiedViewer: true }), 'simplified');
    });

    it('returns web even when useSimplifiedViewer is true but useFullSlicer is false', () => {
        assert.equal(accountDefaultViewer({ useFullSlicer: false, useSimplifiedViewer: true }), 'web');
    });
});

describe('resolveSimplifiedViewerChoice', () => {
    it('returns true when explicitly requested', () => {
        assert.equal(resolveSimplifiedViewerChoice(true, false), true);
        assert.equal(resolveSimplifiedViewerChoice(true, true), true);
    });

    it('returns false when explicitly rejected', () => {
        assert.equal(resolveSimplifiedViewerChoice(false, true), false);
        assert.equal(resolveSimplifiedViewerChoice(false, false), false);
    });

    it('falls back to account default when requested is undefined', () => {
        assert.equal(resolveSimplifiedViewerChoice(undefined, true), true);
        assert.equal(resolveSimplifiedViewerChoice(undefined, false), false);
    });

    it('falls back to account default when requested is null', () => {
        assert.equal(resolveSimplifiedViewerChoice(null, true), true);
        assert.equal(resolveSimplifiedViewerChoice(null, false), false);
    });

    it('defaults account default to false when omitted', () => {
        assert.equal(resolveSimplifiedViewerChoice(undefined), false);
    });
});
