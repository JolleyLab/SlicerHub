import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppMenuItems } from '../../../dev/components/app-menu.js';
import { MY_PROJECTS_VISIBLE, PROJECT_VIEWS, APP_VIEWS } from '../../../dev/components/app-views.js';

const keys = (options) => getAppMenuItems(options).map((item) => item.key);

test('My Projects is hidden while MY_PROJECTS_VISIBLE is false', () => {
    assert.equal(MY_PROJECTS_VISIBLE, false);
    assert.deepEqual(keys({ directusCasesEnabled: true, projectCaseMigrateEnabled: true }), ['cases', 'my-files']);
    assert.deepEqual(keys({ directusCasesEnabled: true, projectCaseMigrateEnabled: false }), ['cases', 'my-files']);
    assert.deepEqual(keys({ directusCasesEnabled: false }), ['my-files']);
});

test('every My Projects view is covered by the redirect guard', () => {
    assert.deepEqual(
        [...PROJECT_VIEWS].sort(),
        [APP_VIEWS.PROJECTS, APP_VIEWS.CREATE_PROJECT, APP_VIEWS.PROJECT_REVIEW].sort()
    );
});
