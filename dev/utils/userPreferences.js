import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';
import { applyTheme, getSystemColorScheme } from '../components/theme.js';
import {
    DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS,
    normalizeLocalSlicerViewerOptions
} from './localSlicerViewerOptions.js';
import { DEFAULT_HOME_LAYOUT, normalizeHomeLayout } from './homeLayout.js';

export const DEFAULT_USER_PREFERENCES = Object.freeze({
    theme: 'light',
    ...DEFAULT_LOCAL_SLICER_VIEWER_OPTIONS,
    homeLayout: DEFAULT_HOME_LAYOUT,
    slicerWebChannel: 'stable',
    notifyRegistrationApproval: true
});

const THEME_CACHE_KEY = 'ui-theme';
const LEGACY_VIEWER_OPTIONS_KEY = 'user-local-slicer-viewer-options';

let cachedPreferences = { ...DEFAULT_USER_PREFERENCES };
// Incremented on every explicit user-initiated save; hydration skips applying if it changed.
let _saveGeneration = 0;

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
        notifyRegistrationApproval: input?.notifyRegistrationApproval !== false
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
    // Pages that render from preferences (Home) redraw when they change.
    window.dispatchEvent(new CustomEvent('user-preferences-changed'));
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
        const message = data.error?.message || data.message || t('common.requestFailed');
        const err = new Error(typeof message === 'string' ? message : t('common.requestFailed'));
        err.status = response.status;
        throw err;
    }
    return data;
}

/**
 * Apply preferences from login/me payload. Accounts still at the defaults get one-time migration of
 * the legacy browser-stored viewer options.
 *
 * The theme is never migrated from the device: "light" is the default, so an account that chose
 * light is indistinguishable from an untouched one, and the device theme (which the signed-out
 * screens overwrite with the OS scheme) would replace the saved choice on every refresh. New
 * accounts are seeded with the device theme at registration instead.
 */
export async function hydrateUserPreferencesFromUser(user) {
    const snapshotGen = _saveGeneration;
    let preferences = normalizeUserPreferences(user?.preferences || {});

    if (isDefaultPreferences(preferences)) {
        const legacy = readLegacyLocalViewerOptions();
        if (legacy && (legacy.useFullSlicer || legacy.useSimplifiedViewer)) {
            try {
                preferences = await saveUserPreferences(legacy);
                clearLegacyLocalViewerOptions();
                return preferences;
            } catch (err) {
                console.warn('Could not migrate local preferences to account:', err.message);
            }
        }
    }

    clearLegacyLocalViewerOptions();
    if (_saveGeneration !== snapshotGen) {
        // User explicitly changed preferences while this background hydration was in-flight.
        return getCachedUserPreferences();
    }
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
    const myGen = ++_saveGeneration;
    const response = await fetch(`${API_URL}/api/auth/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch)
    });
    const data = await parseResponse(response);
    if (myGen < _saveGeneration) {
        // A newer save is already in-flight; don't apply this stale response.
        return getCachedUserPreferences();
    }
    return applyUserPreferences(data.preferences || patch);
}

export function clearCachedUserPreferences() {
    cachedPreferences = { ...DEFAULT_USER_PREFERENCES };
}
