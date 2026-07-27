export const APP_MENU_ITEMS = Object.freeze([
    Object.freeze({ key: 'my-files', label: 'My Files' }),
    Object.freeze({ key: 'my-projects', label: 'My Projects' })
]);

export const CASES_MENU_ITEM = Object.freeze({ key: 'cases', label: 'Cases' });

export const DEFAULT_MENU_KEY = 'my-files';

/**
 * Build nav items from server feature flags.
 */
export function getAppMenuItems({ directusCasesEnabled = false } = {}) {
    const items = [...APP_MENU_ITEMS];
    if (directusCasesEnabled) {
        items.push(CASES_MENU_ITEM);
    }
    return Object.freeze(items);
}
