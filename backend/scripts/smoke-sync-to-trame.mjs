import { syncFileToTrame } from '../src/gpu/trameFileSync.js';

const userId = process.argv[2] || '1';
const fileName = process.argv[3] || '2026-02-06-Scene.mrb';
const syncToken = process.env.TRAME_SYNC_TOKEN || 'test-sync-token-local';
const trameUrl = process.env.TRAME_SERVICE_URL || 'http://trame-service:8090';

const instance = {
    trameServiceUrl: trameUrl,
    metadata: { syncToken }
};

const storageKey = `userFiles/${userId}/${fileName}`;

try {
    const result = await syncFileToTrame(instance, { userId, storageKey, fileName });
    console.log('OK', JSON.stringify(result, null, 2));
} catch (err) {
    console.error('FAIL', err.message || err);
    process.exit(1);
}
