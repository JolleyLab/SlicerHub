/**
 * Account-backed user preferences (theme + Local viewer options).
 * Server is source of truth; localStorage is a short-lived cache for theme flash.
 */

import { API_URL } from '../config.js';
import { applyTheme } from '../components/theme.js';
import {
    DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS,
    normalizeLocalSlicerViewerOptions
} from './localSlicerViewerOptions.js';

export const DEFAULT_USER_PREFERENCES = Object.freeze({
    theme: 'light',
    ...DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS
});

const THEME_CACHE_KEY = 'ui-theme';
const LEGACY_VIEWER_OPTIONS_KEY = 'user-local-slicer-viewer-options';

let cachedPreferences = { ...DEFAULT_USER_PREFERENCES };

export function normalizeUserPreferences(input = {}) {
    const theme = input?.theme === 'dark' ? 'dark' : 'light';
    const viewer = normalizeLocalSlicerViewerOptions(input);
    return {
        theme,
        useFullSlicer: viewer.useFullSlicer,
        useSimplifiedViewer: viewer.useSimplifiedViewer
    };
}

export function getCachedUserPreferences() {
    return { ...cachedPreferences };
}

export function getCachedLocalSlicerViewerOptions() {
    return normalizeLocalSlicerViewerOptions(cachedPreferences);
}

function cacheThemeLocally(theme) {
    try {
        localStorage.setItem(THEME_CACHE_KEY, theme === 'dark' ? 'dark' : 'light');
    } catch (_) {
        /* ignore */
    }
}

function readLegacyLocalViewerOptions() {
    try {
        const raw = localStorage.getItem(LEGACY_VIEWER_OPTIONS_KEY);
        if (!raw) return null;
        return normalizeLocalSlicerViewerOptions(JSON.parse(raw));
    } catch (_) {
        return null;
    }
}

function clearLegacyLocalViewerOptions() {
    try {
        localStorage.removeItem(LEGACY_VIEWER_OPTIONS_KEY);
    } catch (_) {
        /* ignore */
    }
}

function isDefaultPreferences(prefs) {
    const n = normalizeUserPreferences(prefs);
    return n.theme === DEFAULT_USER_PREFERENCES.theme
        && n.useFullSlicer === DEFAULT_USER_PREFERENCES.useFullSlicer
        && n.useSimplifiedViewer === DEFAULT_USER_PREFERENCES.useSimplifiedViewer;
}

export function applyUserPreferences(preferences = {}) {
    cachedPreferences = normalizeUserPreferences(preferences);
    applyTheme(cachedPreferences.theme);
    cacheThemeLocally(cachedPreferences.theme);
    return getCachedUserPreferences();
}

async function parseResponse(response) {
    let data = {};
    try {
        data = await response.json();
    } catch (_) {
        data = {};
    }
    if (!response.ok) {
        const message = data.error?.message || data.message || 'Request failed';
        const err = new Error(typeof message === 'string' ? message : 'Request failed');
        err.status = response.status;
        throw err;
    }
    return data;
}

/**
 * Apply preferences from login/me payload. Optionally migrate one-time
 * browser-local viewer options into the account when the server still has defaults.
 */
export async function hydrateUserPreferencesFromUser(user) {
    let preferences = normalizeUserPreferences(user?.preferences || {});

    if (isDefaultPreferences(preferences)) {
        const legacy = readLegacyLocalViewerOptions();
        let themeFromBrowser = null;
        try {
            themeFromBrowser = localStorage.getItem(THEME_CACHE_KEY);
        } catch (_) {
            themeFromBrowser = null;
        }

        const migrationPatch = {};
        if (legacy && (legacy.useFullSlicer || legacy.useSimplifiedViewer)) {
            Object.assign(migrationPatch, legacy);
        }
        if (themeFromBrowser === 'dark' || themeFromBrowser === 'light') {
            migrationPatch.theme = themeFromBrowser;
        }

        if (Object.keys(migrationPatch).length > 0) {
            try {
                preferences = await saveUserPreferences(migrationPatch);
                clearLegacyLocalViewerOptions();
                return preferences;
            } catch (err) {
                console.warn('Could not migrate local preferences to account:', err.message);
            }
        }
    }

    clearLegacyLocalViewerOptions();
    return applyUserPreferences(preferences);
}

export async function saveUserPreferences(patch = {}) {
    const response = await fetch(`${API_URL}/api/auth/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch)
    });
    const data = await parseResponse(response);
    return applyUserPreferences(data.preferences || patch);
}

export function clearCachedUserPreferences() {
    cachedPreferences = { ...DEFAULT_USER_PREFERENCES };
}
