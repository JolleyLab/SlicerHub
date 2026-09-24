import { t } from '../i18n/index.js';
import { MY_PROJECTS_VISIBLE } from './app-views.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access.
 * My Projects is hidden while MY_PROJECTS_VISIBLE is false (see app-views.js).
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({
    directusCasesEnabled = false,
    projectCaseMigrateEnabled = false
} = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    const projectsItem = Object.freeze({ key: 'my-projects', label: t('nav.myProjects') });
    let items;
    if (directusCasesEnabled) {
        items = projectCaseMigrateEnabled
            ? [casesItem, projectsItem, filesItem]
            : [casesItem, filesItem];
    } else {
        // Cases off: legacy My Projects + My Files
        items = [projectsItem, filesItem];
    }
    return Object.freeze(items.filter((item) => MY_PROJECTS_VISIBLE || item !== projectsItem));
}
