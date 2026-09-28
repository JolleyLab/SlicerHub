import test from 'node:test';
import assert from 'node:assert/strict';
import { condensedTime, fullTime } from '../../../dev/utils/condensedTime.js';

const NOW = Date.parse('2026-09-25T15:00:00Z');
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const at = (value) => condensedTime(value, { now: NOW, locale: 'en' });

test('under a minute is "now"', () => {
    assert.equal(at(ago(5)), 'now');
    assert.equal(at(ago(59)), 'now');
});

test('minutes and hours read as relative times', () => {
    assert.equal(at(ago(5 * 60)), '5 min. ago');
    assert.equal(at(ago(59 * 60)), '59 min. ago');
    assert.equal(at(ago(2 * 3600)), '2 hr. ago');
    assert.equal(at(ago(23 * 3600)), '23 hr. ago');
});

test('a day back is "yesterday", then a short date', () => {
    assert.equal(at(ago(26 * 3600)), 'yesterday');
    assert.match(at(ago(3 * 86400)), /^(Sept?|Sep)\s*22$|^22\s*Sep/);
});

test('an invalid or missing time is empty, never "Invalid Date"', () => {
    for (const bad of [undefined, null, '', 'not a date']) {
        assert.equal(at(bad), '');
        assert.equal(fullTime(bad), '');
    }
});

test('a time slightly in the future does not crash and reads as soon', () => {
    assert.equal(at(new Date(NOW + 30_000).toISOString()), 'now');
    assert.equal(at(new Date(NOW + 10 * 60_000).toISOString()), 'in 10 min.');
});
