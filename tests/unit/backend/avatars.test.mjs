import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// Lists of people only carry an avatarUrl when the person has a picture.
const stored = new Set(['avatars/has-one.png']);
const prefixes = [];
let failNext = false;
mock.module('../../../backend/src/storage/index.js', {
    defaultExport: {
        avatarKeyForSub: (sub, ext) => `avatars/${sub}.${ext}`,
        listByPrefix: async (prefix) => {
            prefixes.push(prefix);
            if (failNext) { failNext = false; throw new Error('storage down'); }
            return [...stored].filter((k) => k.startsWith(prefix));
        },
    },
});

const { avatarUrlFor, findAvatarKey, forgetAvatar } = await import('../../../backend/src/services/avatars.js');

test('a URL only for people who have a picture', async () => {
    assert.equal(await avatarUrlFor('has-one'), '/api/users/has-one/avatar');
    assert.equal(await avatarUrlFor('no-picture'), null);
    assert.equal(await avatarUrlFor(''), null);
    assert.equal(await findAvatarKey('has-one'), 'avatars/has-one.png');
});

test('one sub never matches another that starts the same way', async () => {
    stored.add('avatars/abc-longer.png');
    assert.equal(await findAvatarKey('abc'), null);
    assert.equal(prefixes.at(-1), 'avatars/abc.');
});

test('the answer is cached until the person changes their own picture', async () => {
    const sub = 'cache-check';
    assert.equal(await avatarUrlFor(sub), null);
    const lookups = prefixes.length;
    stored.add(`avatars/${sub}.jpg`); // uploaded
    assert.equal(await avatarUrlFor(sub), null, 'still cached');
    assert.equal(prefixes.length, lookups, 'no second storage lookup');
    forgetAvatar(sub); // what the upload route does
    assert.equal(await avatarUrlFor(sub), `/api/users/${sub}/avatar`);
});

test('a storage error shows initials and is not cached', async () => {
    failNext = true;
    assert.equal(await avatarUrlFor('has-one-2'), null);
    stored.add('avatars/has-one-2.png');
    assert.equal(await avatarUrlFor('has-one-2'), '/api/users/has-one-2/avatar');
});
