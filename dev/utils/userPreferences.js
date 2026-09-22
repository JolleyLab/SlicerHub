import { API_URL } from '../config.js';
import { applyTheme, getSystemColorScheme } from '../components/theme.js';
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

/** Device theme for seeding a new account (toggle can override later). */
export function resolvePreferredThemeForNewAccount() {
    try {
        const cached = localStorage.getItem(THEME_CACHE_KEY);
        if (cached === 'dark' || cached === 'light') return cached;
    } catch (_) {
        /* ignore */
    }
    return getSystemColorScheme();
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
 * browser/OS theme (+ legacy viewer options) into the account when still at defaults.
 */
export async function hydrateUserPreferencesFromUser(user) {
    let preferences = normalizeUserPreferences(user?.preferences || {});

    if (isDefaultPreferences(preferences)) {
        const legacy = readLegacyLocalViewerOptions();
        const themeFromDevice = resolvePreferredThemeForNewAccount();

        const migrationPatch = {};
        if (legacy && (legacy.useFullSlicer || legacy.useSimplifiedViewer)) {
            Object.assign(migrationPatch, legacy);
        }
        if (themeFromDevice === 'dark' || themeFromDevice === 'light') {
            migrationPatch.theme = themeFromDevice;
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

/**
 * Refresh preferences from /api/auth/me (source of truth for account settings).
 */
export async function fetchUserPreferences() {
    const response = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include'
    });
    const data = await parseResponse(response);
    return applyUserPreferences(data.user?.preferences || {});
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
