export const APP_VIEWS = Object.freeze({
    HOME: 'home',
    FILES: 'files',
    PROJECTS: 'projects',
    CREATE_PROJECT: 'create-project',
    PROJECT_REVIEW: 'project-review',
    SETTINGS: 'settings',
    CASES: 'cases',
    ADMIN_REGISTRATIONS: 'admin-registrations',
    MY_GROUPS: 'my-groups',
    WORKFLOWS: 'workflows'
});

export const DEFAULT_APP_VIEW = APP_VIEWS.HOME;

/**
 * My Projects (the legacy project list, project review and create-project pages) is hidden: Cases
 * replaced it. The code is kept for now; set this to true to bring back the nav entry and views.
 */
export const MY_PROJECTS_VISIBLE = false;

/**
 * My Files is hidden by default: legacy file manager, kept while useful code is extracted.
 * Set to true to bring back the nav entry and view.
 */
export const MY_FILES_VISIBLE = false;

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

/** Deep-link params each view owns (an open case, an open workflow…). */
const VIEW_DEEP_LINK_PARAMS = Object.freeze({
    [APP_VIEWS.CASES]: ['case', 'viewer'],
    [APP_VIEWS.WORKFLOWS]: ['workflow', 'tab', 'edit'],
});

/**
 * Write SPA view state into the URL without reloading.
 * Keeps unrelated query params (e.g. share) intact.
 * Drops other views' deep-link params, and with `clearDeepLink` (returning to a view via
 * the menu) the current view's too, so people land on its list.
 */
export function writeAppViewToUrl({
    currentView,
    selectedProjectId = null,
    replace = true,
    clearDeepLink = false
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

    // A deep link only means something on its own view. Leaving the view (or asking for its
    // list) must drop it — otherwise remounting restores the old detail (e.g. "only one case").
    for (const [view, keys] of Object.entries(VIEW_DEEP_LINK_PARAMS)) {
        if (currentView !== view || clearDeepLink) keys.forEach((key) => params.delete(key));
    }

    const next = `${url.pathname}${params.toString() ? `?${params}` : ''}${url.hash}`;
    if (replace) {
        history.replaceState(null, '', next);
    } else {
        history.pushState(null, '', next);
    }
}

/**
 * Set query params on the current URL (null or '' removes one) without reloading.
 * Adds a history entry (so Back undoes it) unless `replace`; does nothing if nothing changes.
 */
export function updateUrlParams(updates, { replace = false } = {}) {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === '') url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
    }
    if (url.href === window.location.href) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash);
}
