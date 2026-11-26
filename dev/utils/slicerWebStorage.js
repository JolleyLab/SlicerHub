/**
 * SlicerWeb runs on the SlicerHub origin and keeps its state in this browser, not in the
 * SlicerHub account: hand-installed extensions (wheel URLs) and settings in localStorage
 * (`slicerweb.*`), and autosaved scenes in IndexedDB (its Pyodide file system; one database
 * per mount, named after the path under /home/pyodide/). So on a shared browser the next
 * person would get the previous person's extensions, which run with their session, and
 * scenes. Clear it all on sign-out and when a different user signs in.
 */

const KEY_PREFIX = 'slicerweb.';
const DB_PREFIX = '/home/pyodide/';
const OWNER_KEY = 'sh-slicerweb-owner';

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function deleteSlicerWebDatabases(idb) {
    if (typeof idb?.databases !== 'function') return;
    const names = (await idb.databases())
        .map((db) => db.name)
        .filter((name) => name?.startsWith(DB_PREFIX));
    // Resolve on `blocked` too: a SlicerWeb tab still open keeps its database until it closes,
    // and the browser finishes the deletion then.
    await Promise.all(names.map((name) => new Promise((resolve) => {
        const req = idb.deleteDatabase(name);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    })));
}

/** Remove SlicerWeb's localStorage keys and autosave databases. Never throws; waits at most `timeoutMs`. */
export async function clearSlicerWebStorage({
    storage = globalThis.localStorage,
    idb = globalThis.indexedDB,
    timeoutMs = 2000,
} = {}) {
    try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(KEY_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
        storage.removeItem(OWNER_KEY);
    } catch { /* storage blocked: nothing to clear */ }
    try {
        await withTimeout(deleteSlicerWebDatabases(idb), timeoutMs);
    } catch { /* IndexedDB unavailable */ }
}

/**
 * Mark this browser's SlicerWeb state as `userId`'s, clearing it first if it isn't already
 * theirs, including state left from before this marker existed.
 */
export async function claimSlicerWebStorage(userId, options = {}) {
    const owner = userId == null ? '' : String(userId);
    if (!owner) return;
    const storage = options.storage ?? globalThis.localStorage;
    try {
        if (storage.getItem(OWNER_KEY) === owner) return;
    } catch {
        return;
    }
    await clearSlicerWebStorage(options);
    try { storage.setItem(OWNER_KEY, owner); } catch { /* ignore */ }
}
