import localStorage from './localStorage.js';

const requested = (process.env.STORAGE_BACKEND || 'local').trim().toLowerCase();

let activeStorage = localStorage;

if (requested === 'object') {
    // To implement: create objectStorage.js implementing the contract in contract.js.
    // Required env vars: STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_REGION.
    // Works with AWS S3, Azure Blob (via S3-compatible endpoint), or MinIO for local dev.
    // All methods mirror localStorage.js — swap write/read/delete/listByPrefix for SDK calls.
    // getPresignedReadUrl() should return a signed URL so the client fetches directly from the store.
    console.warn(
        'STORAGE_BACKEND=object is not implemented yet; falling back to local disk.'
    );
}

export default activeStorage;
export { requested as storageBackend };
