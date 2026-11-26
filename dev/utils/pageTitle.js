/**
 * The browser tab's title (WCAG 2.4.2): what's on screen, then the app name, e.g.
 * "Cardiac planning – Workflows – SlicerHub". Call with no parts for the app name alone.
 */
const APP_NAME = (typeof document !== 'undefined' && document.title) || 'SlicerHub';

export function setPageTitle(...parts) {
    document.title = [...parts.filter(Boolean), APP_NAME].join(' – ');
}
