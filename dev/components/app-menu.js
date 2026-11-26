import { t } from '../i18n/index.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases first, then Workflows, My Files (when enabled) and My Groups. Home is reached from the header
 * link, so it has no entry here.
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({ filesEnabled = false } = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    const workflowsItem = Object.freeze({ key: 'workflows', label: t('nav.workflows') });
    const myGroupsItem = Object.freeze({ key: 'my-groups', label: t('nav.myGroups') });
    const items = [casesItem, workflowsItem];
    if (filesEnabled) items.push(filesItem);
    items.push(myGroupsItem);
    return Object.freeze(items);
}
