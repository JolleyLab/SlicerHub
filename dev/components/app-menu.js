import { t } from '../i18n/index.js';

export const DEFAULT_MENU_KEY = 'cases';

/**
 * Build nav items from server feature flags.
 * Cases is shown first when enabled; My Files remains as secondary access.
 * CUTOVER (project-case-migrate): My Projects stays in nav while migrate is on.
 * Labels are resolved via t() so locale packs take effect at call time.
 */
export function getAppMenuItems({
    directusCasesEnabled = false,
    projectCaseMigrateEnabled = false
} = {}) {
    const filesItem = Object.freeze({ key: 'my-files', label: t('nav.myFiles') });
    const casesItem = Object.freeze({ key: 'cases', label: t('nav.myCases') });
    const projectsItem = Object.freeze({ key: 'my-projects', label: t('nav.myProjects') });
    if (directusCasesEnabled) {
        if (projectCaseMigrateEnabled) {
            return Object.freeze([casesItem, projectsItem, filesItem]);
        }
        return Object.freeze([casesItem, filesItem]);
    }
    // Cases off: legacy My Projects + My Files
    return Object.freeze([projectsItem, filesItem]);
}
