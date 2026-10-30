/**
 * Per-account UI / Local viewer preferences (JSON on users.preferences_json).
 */

import {
    DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS,
    normalizeLocalSlicerViewerOptions
} from './localSlicerViewerOptions.js';
import { normalizeHomeLayout } from '../utils/homeLayout.js';

export const ALL_ACTIVITY_CATEGORIES = Object.freeze(['collaboration', 'mention', 'comment', 'attachment']);

/** null = all categories shown (default); array = only those categories */
export function normalizeActivityFilters(input) {
    if (!Array.isArray(input)) return null;
    const valid = input.filter(c => ALL_ACTIVITY_CATEGORIES.includes(c));
    if (valid.length === 0 || valid.length >= ALL_ACTIVITY_CATEGORIES.length) return null;
    return valid;
}

export const DEFAULT_USER_PREFERENCES = Object.freeze({
    theme: 'light',
    ...DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS,
    homeLayout: normalizeHomeLayout(null),
    slicerWebChannel: 'stable',
    notifyRegistrationApproval: true,
    activityFilters: ['comment'],
});

export function normalizeUserPreferences(input = {}) {
    const theme = input?.theme === 'dark' ? 'dark' : 'light';
    const viewer = normalizeLocalSlicerViewerOptions(input);
    const slicerWebChannel = input?.slicerWebChannel === 'latest' ? 'latest' : 'stable';
    return {
        theme,
        useFullSlicer: viewer.useFullSlicer,
        useSimplifiedViewer: viewer.useSimplifiedViewer,
        homeLayout: normalizeHomeLayout(input?.homeLayout),
        slicerWebChannel,
        notifyRegistrationApproval: input?.notifyRegistrationApproval !== false,
        activityFilters: normalizeActivityFilters(input?.activityFilters),
    };
}

export function parseUserPreferencesJson(raw) {
    if (!raw) {
        return { ...DEFAULT_USER_PREFERENCES };
    }
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return normalizeUserPreferences(parsed || {});
    } catch {
        return { ...DEFAULT_USER_PREFERENCES };
    }
}

export function mergeUserPreferences(existing = {}, patch = {}) {
    return normalizeUserPreferences({
        ...normalizeUserPreferences(existing),
        ...patch
    });
}

export function viewerModeChanged(before, after) {
    const a = normalizeUserPreferences(before);
    const b = normalizeUserPreferences(after);
    return a.useFullSlicer !== b.useFullSlicer
        || a.useSimplifiedViewer !== b.useSimplifiedViewer;
}
