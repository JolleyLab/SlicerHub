import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let respond = () => ({ status: 200, body: {} });
globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    const { status, body } = respond(url, init);
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (body === undefined ? Promise.reject(new Error('no body')) : body),
    };
};

const { apiRequest } = await import('../../../dev/services/apiResponse.js');
const {
    approveCaseWorkflow, deleteWorkflow, listMyWorkflows, listPublicWorkflows, listAvailableCaseWorkflows,
    loadExtensionCatalog, uploadWorkflowIcon,
} = await import('../../../dev/services/workflows.js');

beforeEach(() => {
    calls.length = 0;
    respond = () => ({ status: 200, body: {} });
});

describe('apiRequest', () => {
    it('sends the session cookie and JSON bodies', async () => {
        respond = () => ({ status: 201, body: { approval: { id: 1 } } });
        assert.deepEqual(await approveCaseWorkflow('7', 11), { id: 1 });
        const [c] = calls;
        assert.equal(c.url, '/api/cases/7/workflows');
        assert.equal(c.method, 'POST');
        assert.equal(c.credentials, 'include');
        assert.equal(c.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(c.body), { workflowId: 11 });
    });

    it('sends no body or content type for GET, and unwraps the result', async () => {
        respond = () => ({ status: 200, body: { workflows: [{ id: 1 }] } });
        assert.deepEqual(await listMyWorkflows(), [{ id: 1 }]);
        assert.equal(calls[0].method, 'GET');
        assert.equal('body' in calls[0], false);
        assert.equal('headers' in calls[0], false);
    });

    it('sends an icon as multipart form data, leaving the content type to the browser', async () => {
        respond = () => ({ status: 200, body: { workflow: { id: 4, iconUrl: '/api/workflows/4/icon?v=1' } } });
        const file = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
        assert.equal((await uploadWorkflowIcon(4, file)).iconUrl, '/api/workflows/4/icon?v=1');
        const [c] = calls;
        assert.equal(c.url, '/api/workflows/4/icon');
        assert.equal(c.method, 'PUT');
        assert.ok(c.body instanceof FormData);
        assert.ok(c.body.get('icon'));
        assert.equal('headers' in c, false);
    });

    it('resolves null for 204', async () => {
        respond = () => ({ status: 204, body: undefined });
        assert.equal(await deleteWorkflow(3), null);
    });

    it('throws the server message with the status', async () => {
        respond = () => ({ status: 403, body: { error: { message: 'Only the owner can change this' } } });
        await assert.rejects(apiRequest('/api/workflows/1', { method: 'PATCH', body: {} }), (err) => {
            assert.equal(err.status, 403);
            assert.equal(err.message, 'Only the owner can change this');
            return true;
        });
    });
});

describe('loadExtensionCatalog', () => {
    it('keeps name/description/category/modules, strips markup and icons, sorts, and caches per channel', async () => {
        respond = () => ({ status: 200, body: { extensions: [
            { name: 'SlicerRT', description: 'Radiation', category: 'Radiotherapy', icon: 'https://example.com/i.png', modules: ['Isodose', 7] },
            { name: 'ExtraMarkups', description: 'A <i>Label</i> node' },
        ] } });
        const catalog = await loadExtensionCatalog('stable');
        assert.deepEqual(catalog, [
            { name: 'ExtraMarkups', description: 'A Label node', category: '', modules: [] },
            { name: 'SlicerRT', description: 'Radiation', category: 'Radiotherapy', modules: ['Isodose'] },
        ]);
        assert.equal(calls[0].url, '/slicerweb/stable/extensions/index.json');
        await loadExtensionCatalog('stable');
        assert.equal(calls.length, 1);
    });

    it('retries after a failure', async () => {
        respond = () => ({ status: 404, body: {} });
        await assert.rejects(loadExtensionCatalog('latest'));
        respond = () => ({ status: 200, body: { extensions: [] } });
        assert.deepEqual(await loadExtensionCatalog('latest'), []);
        assert.equal(calls.length, 2);
    });
});

describe('paged workflow lists', () => {
    it('ask for one page of a search, leaving out what is empty, and return { items, hasMore }', async () => {
        respond = () => ({ status: 200, body: { workflows: [{ id: 1 }], hasMore: true } });
        assert.deepEqual(await listPublicWorkflows({ q: 'valve tools', sort: 'newest', page: 2 }), { items: [{ id: 1 }], hasMore: true });
        assert.equal(calls[0].url, '/api/workflows?scope=public&q=valve+tools&sort=newest&page=2');

        await listPublicWorkflows({ q: '', page: 1 });
        assert.equal(calls[1].url, '/api/workflows?scope=public');
        await listAvailableCaseWorkflows('7', { q: 'heart' });
        assert.equal(calls[2].url, '/api/cases/7/workflows/available?q=heart');
    });
});
