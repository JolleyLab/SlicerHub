import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppMenuItems } from '../../../dev/components/app-menu.js';
import { MY_FILES_VISIBLE, MY_PROJECTS_VISIBLE, PROJECT_VIEWS, APP_VIEWS } from '../../../dev/components/app-views.js';

const keys = (options) => getAppMenuItems(options).map((item) => item.key);

test('My Projects is hidden while MY_PROJECTS_VISIBLE is false', () => {
    assert.equal(MY_PROJECTS_VISIBLE, false);
    assert.deepEqual(keys({ directusCasesEnabled: true, projectCaseMigrateEnabled: true }), ['cases', 'my-groups']);
    assert.deepEqual(keys({ directusCasesEnabled: true, projectCaseMigrateEnabled: false }), ['cases', 'my-groups']);
    assert.deepEqual(keys({ directusCasesEnabled: false }), ['my-groups']);
});

test('My Files is hidden while MY_FILES_VISIBLE is false', () => {
    assert.equal(MY_FILES_VISIBLE, false);
    assert.ok(!keys({ directusCasesEnabled: true }).includes('my-files'));
});

test('Pending Registrations is not a nav item — it lives in My Groups task section', () => {
    assert.deepEqual(
        keys({ directusCasesEnabled: true, isRegistrationReviewer: true }),
        ['cases', 'my-groups']
    );
    assert.deepEqual(
        keys({ directusCasesEnabled: true, isRegistrationReviewer: false }),
        ['cases', 'my-groups']
    );
});

test('every My Projects view is covered by the redirect guard', () => {
    assert.deepEqual(
        [...PROJECT_VIEWS].sort(),
        [APP_VIEWS.PROJECTS, APP_VIEWS.CREATE_PROJECT, APP_VIEWS.PROJECT_REVIEW].sort()
    );
});

test('Home is the default view and is reached from the header, not the side menu', async () => {
    const { DEFAULT_APP_VIEW } = await import('../../../dev/components/app-views.js');
    assert.equal(DEFAULT_APP_VIEW, APP_VIEWS.HOME);
    assert.ok(!keys({ directusCasesEnabled: true }).includes('home'));
});
