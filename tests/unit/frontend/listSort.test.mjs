import test from 'node:test';
import assert from 'node:assert/strict';
import { LIST_SORT_OPTIONS, filterByText, sortRows } from '../../../dev/utils/listSort.js';

const rows = [
    { id: 1, name: 'beta', at: '2026-01-02T00:00:00Z', tags: ['SlicerRT'] },
    { id: 2, name: 'Alpha', at: '2026-01-03T00:00:00Z', tags: [] },
    { id: 3, name: 'gamma', at: '', tags: ['SlicerIGT'] },
];
const by = { titleOf: (r) => r.name, timeOf: (r) => r.at };
const ids = (list) => list.map((r) => r.id);

test('sort options are newest, oldest, title', () => {
    assert.deepEqual(LIST_SORT_OPTIONS.map((o) => o.value), ['newest', 'oldest', 'title']);
});

test('filterByText matches any field, case-insensitively, and copies the list', () => {
    assert.deepEqual(ids(filterByText(rows, 'slicerigt', (r) => [r.name, ...r.tags])), [3]);
    assert.deepEqual(ids(filterByText(rows, '  ALPHA ', (r) => [r.name])), [2]);
    const all = filterByText(rows, '', (r) => [r.name]);
    assert.deepEqual(ids(all), [1, 2, 3]);
    assert.notEqual(all, rows);
    assert.deepEqual(filterByText(null, 'x', () => []), []);
});

test('sortRows: newest/oldest first with undated rows last, title A–Z', () => {
    assert.deepEqual(ids(sortRows(rows, 'newest', by)), [2, 1, 3]);
    assert.deepEqual(ids(sortRows(rows, 'oldest', by)), [1, 2, 3]);
    assert.deepEqual(ids(sortRows(rows, 'title', by)), [2, 1, 3]);
    assert.deepEqual(ids(rows), [1, 2, 3]); // input untouched
});
