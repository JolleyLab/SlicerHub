import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// The service reads its cache location and the app database from the environment at import time.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-cache-test-'));
const cacheDir = path.join(scratch, 'cache');
process.env.DIRECTUS_CACHE_DIR = cacheDir;
process.env.DB_PATH = path.join(scratch, 'test.db');
process.env.DB_SEED_PATH = path.join(scratch, 'no-seed.db');
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const { findCachedDirectusAsset } = await import('../../../backend/src/services/directus.js');

const put = (name, contents) => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, name), contents);
};

test('finds a complete cached copy without downloading or copying anything', () => {
    put('file-1-scan.nrrd', '0123456789');
    const found = findCachedDirectusAsset({ fileId: 'file-1', filenameDownload: 'scan.nrrd', expectedSize: 10 });
    assert.equal(found.fileName, 'scan.nrrd');
    assert.equal(found.bytes, 10);
    assert.equal(fs.readFileSync(found.cachePath, 'utf8'), '0123456789');
});

test('a cached file of the wrong size (a partial or stale copy) is not used', () => {
    put('file-2-scan.nrrd', '0123');
    assert.equal(findCachedDirectusAsset({ fileId: 'file-2', filenameDownload: 'scan.nrrd', expectedSize: 10 }), null);
});

test('an unknown size accepts whatever complete file is there; a missing file is null', () => {
    put('file-3-scan.nrrd', '0123');
    assert.ok(findCachedDirectusAsset({ fileId: 'file-3', filenameDownload: 'scan.nrrd' }));
    assert.equal(findCachedDirectusAsset({ fileId: 'file-4', filenameDownload: 'scan.nrrd' }), null);
    assert.equal(findCachedDirectusAsset({ fileId: '' }), null);
});

test('the file name cannot escape the cache directory', () => {
    put('file-5-evil.bin', 'x');
    const found = findCachedDirectusAsset({ fileId: 'file-5', filenameDownload: '../../evil.bin' });
    assert.ok(found.cachePath.startsWith(cacheDir), found.cachePath);
});

test('an in-progress download (.tmp) is never mistaken for a cached copy', () => {
    put('file-6-scan.nrrd.tmp', 'half');
    assert.equal(findCachedDirectusAsset({ fileId: 'file-6', filenameDownload: 'scan.nrrd' }), null);
});
