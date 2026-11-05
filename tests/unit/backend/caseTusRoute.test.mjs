import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// The TUS upload route must require collaborator access to the case in the URL, refuse
// GET (which @tus/server would answer with the file bytes), and only let the original
// uploader resume/inspect/cancel an upload on the case it was started on.
process.env.AUTH_PROVIDER = 'keycloak';

// @tus/* are resolved from backend/node_modules, so mock them at that resolved path.
const tusPkg = (name) => new URL(`../../../backend/node_modules/@tus/${name}/dist/index.js`, import.meta.url).href;

const uploads = {}; // uploadId -> { id, metadata }
let tusOptions = null;
const tusHandled = [];
mock.module(tusPkg('file-store'), {
    namedExports: {
        FileStore: class {
            async getUpload(id) {
                if (!uploads[id]) throw new Error('not found');
                return uploads[id];
            }
        }
    }
});
mock.module(tusPkg('server'), {
    namedExports: {
        Server: class {
            constructor(opts) { tusOptions = opts; }
            handle(req, res) { tusHandled.push(req.method); res.status(204).end(); }
        }
    }
});
mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});

const roles = {}; // `${sub}:${caseId}` -> role
mock.module('../../../backend/src/services/keycloakAdmin.js', {
    namedExports: {
        getKeycloakSubForUser: () => null,
        getUserCaseRole: async (sub, caseId) => roles[`${sub}:${caseId}`] ?? null,
        getUserCaseRoleMap: async () => ({})
    }
});
mock.module('../../../backend/src/services/caseGroupAccess.js', {
    namedExports: {
        getCaseRoleFromGroups: async () => null,
        getCaseRoleMapFromGroups: async () => ({})
    }
});

const { registerCaseTusRoute } = await import('../../../backend/src/routes/caseTus.js');

const cases = { 5: { id: 5, owner_id: 'kc-owner' } };
const payload = {
    async findByID({ collection, id }) {
        if (collection === 'cases' && cases[id]) return cases[id];
        throw new Error('not found');
    },
    async create() { return {}; }
};

const routes = [];
const app = {
    all(path, ...handlers) {
        const keys = [];
        const pattern = path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
        routes.push({ re: new RegExp(`^${pattern}$`), keys, handlers });
    }
};
registerCaseTusRoute(app, payload);

function dispatch(method, path, user) {
    const route = routes.find((r) => r.re.test(path));
    const m = route.re.exec(path);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const req = { method, path, params, user, headers: {} };
    return new Promise((resolve) => {
        const res = {
            _status: 200,
            status(code) { this._status = code; return this; },
            json(body) { resolve({ status: this._status, body }); },
            end() { resolve({ status: this._status }); }
        };
        let i = 0;
        const next = (err) => {
            if (err) return resolve({ error: err });
            route.handlers[i++](req, res, next);
        };
        next();
    });
}

const OWNER = { id: 'kc-owner', role: 'user', keycloakSub: 'kc-owner' };
const COLLAB = { id: 'kc-collab', role: 'user', keycloakSub: 'kc-collab' };
const READER = { id: 'kc-reader', role: 'user', keycloakSub: 'kc-reader' };
const STRANGER = { id: 'kc-stranger', role: 'user', keycloakSub: 'kc-stranger' };

test.beforeEach(() => {
    tusHandled.length = 0;
    for (const k of Object.keys(roles)) delete roles[k];
    for (const k of Object.keys(uploads)) delete uploads[k];
    roles['kc-collab:5'] = 'collaborator';
    roles['kc-reader:5'] = 'read_only';
});

test('someone with no access to the case cannot start an upload', async () => {
    const r = await dispatch('POST', '/api/cases/5/files/tus', STRANGER);
    assert.equal(r.error?.statusCode, 403);
    assert.deepEqual(tusHandled, []);
});

test('read-only collaborators cannot upload', async () => {
    const r = await dispatch('POST', '/api/cases/5/files/tus', READER);
    assert.equal(r.error?.statusCode, 403);
});

test('owners and collaborators can start an upload', async () => {
    assert.equal((await dispatch('POST', '/api/cases/5/files/tus', OWNER)).status, 204);
    assert.equal((await dispatch('POST', '/api/cases/5/files/tus', COLLAB)).status, 204);
    assert.deepEqual(tusHandled, ['POST', 'POST']);
});

test('an unknown case is a 404', async () => {
    assert.equal((await dispatch('POST', '/api/cases/999/files/tus', OWNER)).status, 404);
    assert.equal((await dispatch('POST', '/api/cases/abc/files/tus', OWNER)).status, 404);
});

test('GET is refused so uploads cannot be downloaded through TUS', async () => {
    uploads.u1 = { id: 'u1', metadata: { caseId: '5', uploaderSub: 'kc-owner' } };
    const r = await dispatch('GET', '/api/cases/5/files/tus/u1', OWNER);
    assert.equal(r.status, 405);
    assert.deepEqual(tusHandled, []);
});

test('only the original uploader can resume an upload, and only on its case', async () => {
    uploads.u1 = { id: 'u1', metadata: { caseId: '5', uploaderSub: 'kc-collab' } };
    assert.equal((await dispatch('PATCH', '/api/cases/5/files/tus/u1', COLLAB)).status, 204);
    assert.equal((await dispatch('PATCH', '/api/cases/5/files/tus/u1', OWNER)).status, 404);
    assert.equal((await dispatch('DELETE', '/api/cases/5/files/tus/u1', OWNER)).status, 404);

    cases[6] = { id: 6, owner_id: 'kc-collab' };
    assert.equal((await dispatch('HEAD', '/api/cases/6/files/tus/u1', COLLAB)).status, 404);
    assert.equal((await dispatch('PATCH', '/api/cases/5/files/tus/missing', COLLAB)).status, 404);
});

test('new uploads are stamped with the case and uploader, overriding client metadata', async () => {
    const expressReq = { params: { caseId: '5' }, tusUploaderSub: 'kc-collab' };
    const out = await tusOptions.onUploadCreate(
        { runtime: { node: { req: expressReq } } },
        { metadata: { filename: 'scan.mrb', caseId: '999', uploaderSub: 'kc-owner' } }
    );
    assert.deepEqual(out.metadata, { filename: 'scan.mrb', caseId: '5', uploaderSub: 'kc-collab' });
});

test('finished uploads cannot be deleted through TUS', () => {
    assert.equal(tusOptions.disableTerminationForFinishedUploads, true);
});
