import { t } from '../i18n/index.js';
import { MY_FILES_VISIBLE, MY_PROJECTS_VISIBLE } from './app-views.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access. Home is reached from the
 * header link, so it has no entry here.
 * My Projects is hidden while MY_PROJECTS_VISIBLE is false (see app-views.js).
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({
    directusCasesEnabled = true,
    projectCaseMigrateEnabled = false
} = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    const projectsItem = Object.freeze({ key: 'my-projects', label: t('nav.myProjects') });
    const myGroupsItem = Object.freeze({ key: 'my-groups', label: t('nav.myGroups') });
    const items = [];
    if (directusCasesEnabled) items.push(casesItem);
    if (projectCaseMigrateEnabled) items.push(projectsItem);
    if (MY_FILES_VISIBLE) items.push(filesItem);
    items.push(myGroupsItem);
    return Object.freeze(items.filter((item) => MY_PROJECTS_VISIBLE || item !== projectsItem));
}
