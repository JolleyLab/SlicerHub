import { t } from '../i18n/index.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access. Home is reached from the
 * header link, so it has no entry here.
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({
    directusCasesEnabled = true,
    filesEnabled = false
} = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    const myGroupsItem = Object.freeze({ key: 'my-groups', label: t('nav.myGroups') });
    const items = [];
    if (directusCasesEnabled) items.push(casesItem);
    if (filesEnabled) items.push(filesItem);
    items.push(myGroupsItem);
    return Object.freeze(items);
}
