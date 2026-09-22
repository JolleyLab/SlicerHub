export const APP_MENU_ITEMS = Object.freeze([
    Object.freeze({ key: 'my-files', label: 'My Files' })
    // 'my-projects' hidden — functionality migrated to Cases
]);

export const CASES_MENU_ITEM = Object.freeze({ key: 'cases', label: 'My Cases' });

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access.
 */
export function getAppMenuItems({ directusCasesEnabled = false } = {}) {
    if (directusCasesEnabled) {
        return Object.freeze([CASES_MENU_ITEM, ...APP_MENU_ITEMS]);
    }
    return APP_MENU_ITEMS;
}
