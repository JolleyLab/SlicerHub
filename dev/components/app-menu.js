import { t } from '../i18n/index.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access.
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({ directusCasesEnabled = false } = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    if (directusCasesEnabled) {
        return Object.freeze([casesItem, filesItem]);
    }
    return Object.freeze([filesItem]);
}
