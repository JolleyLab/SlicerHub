import localStorage from './localStorage.js';

const requested = (process.env.STORAGE_BACKEND || 'local').trim().toLowerCase();

let activeStorage = localStorage;

if (requested === 'object') {
    // Future: import objectStorage.js (S3-API client + custom endpoint, no AWS required).
    console.warn(
        'STORAGE_BACKEND=object is not implemented yet; using local disk. See docs/storage.md.'
    );
}

export default activeStorage;
export { requested as storageBackend };
