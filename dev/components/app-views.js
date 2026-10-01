export const APP_VIEWS = Object.freeze({
    HOME: 'home',
    FILES: 'files',
    PROJECTS: 'projects',
    CREATE_PROJECT: 'create-project',
    PROJECT_REVIEW: 'project-review',
    SETTINGS: 'settings',
    CASES: 'cases',
    ADMIN_REGISTRATIONS: 'admin-registrations'
});

export const DEFAULT_APP_VIEW = APP_VIEWS.HOME;

/**
 * My Projects (the legacy project list, project review and create-project pages) is hidden: Cases
 * replaced it. The code is kept for now; set this to true to bring back the nav entry and views.
 */
export const MY_PROJECTS_VISIBLE = false;

export const PROJECT_VIEWS = Object.freeze(new Set([
    APP_VIEWS.PROJECTS,
    APP_VIEWS.CREATE_PROJECT,
    APP_VIEWS.PROJECT_REVIEW
]));

const VIEW_QUERY_KEY = 'view';
const PROJECT_ID_QUERY_KEY = 'projectId';

const VALID_VIEWS = new Set(Object.values(APP_VIEWS));

/**
 * Read SPA view state from the URL (survives refresh).
 * Ignores invalid values; share links are left alone by the caller.
 */
export function readAppViewFromUrl(search = window.location.search) {
    const params = new URLSearchParams(search);
    const view = params.get(VIEW_QUERY_KEY);
    const projectIdRaw = params.get(PROJECT_ID_QUERY_KEY);
    const projectId = Number(projectIdRaw);
    return {
        currentView: VALID_VIEWS.has(view) ? view : null,
        selectedProjectId: Number.isInteger(projectId) && projectId > 0 ? projectId : null
    };
}

/**
 * Write SPA view state into the URL without reloading.
 * Keeps unrelated query params (e.g. share) intact.
 * Clears Directus case deep-link params when not viewing Cases, and when
 * returning to Cases via the app shell (menu), so users land on the list.
 */
export function writeAppViewToUrl({
    currentView,
    selectedProjectId = null,
    replace = true,
    clearCaseDeepLink = false
} = {}) {
    const url = new URL(window.location.href);
    const params = url.searchParams;

    if (!currentView || currentView === DEFAULT_APP_VIEW) {
        params.delete(VIEW_QUERY_KEY);
    } else {
        params.set(VIEW_QUERY_KEY, currentView);
    }

    if (currentView === APP_VIEWS.PROJECT_REVIEW
        && Number.isInteger(Number(selectedProjectId))
        && Number(selectedProjectId) > 0) {
        params.set(PROJECT_ID_QUERY_KEY, String(selectedProjectId));
    } else {
        params.delete(PROJECT_ID_QUERY_KEY);
    }

    // Case detail (?case=) is only meaningful on the Cases view. Leaving Cases
    // (or explicitly asking for the list) must drop it — otherwise remounting
    // Cases restores the old detail and looks like "only one case".
    if (currentView !== APP_VIEWS.CASES || clearCaseDeepLink) {
        params.delete('case');
        params.delete('viewer');
    }

    const next = `${url.pathname}${params.toString() ? `?${params}` : ''}${url.hash}`;
    if (replace) {
        history.replaceState(null, '', next);
    } else {
        history.pushState(null, '', next);
    }
}
