/**
 * Shared harness for backend route tests: register a route module on a minimal Express-like
 * app, dispatch fake requests through its real handlers, over an in-memory Payload.
 * (Several older route tests carry their own copy; move them here when next touched.)
 */

export function makeApp() {
    const routes = [];
    const register = (method) => (path, ...handlers) => {
        const keys = [];
        const pattern = path.replace(/:([^/]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
        routes.push({ method, re: new RegExp(`^${pattern}$`), keys, handlers });
    };
    const app = { routes };
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) app[m] = register(m.toUpperCase());
    return app;
}

/**
 * Run a request through the matching route's handlers. Resolves { status, body }; an error passed to
 * next() (asyncHandler does, for thrown AppErrors) resolves { status: its statusCode, error }.
 */
export function dispatch(app, method, path, { user, body, query } = {}) {
    const route = app.routes.find((r) => r.method === method && r.re.test(path));
    if (!route) throw new Error(`no route for ${method} ${path}`);
    const m = route.re.exec(path);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
    const req = { params, query: query || {}, body: body || {}, user, path, method };

    return new Promise((resolve) => {
        const res = {
            _status: 200,
            status(code) { this._status = code; return this; },
            headers: {},
            set(key, value) { Object.assign(this.headers, typeof key === 'object' ? key : { [key]: value }); return this; },
            setHeader(key, value) { this.headers[key] = value; },
            json(data) { resolve({ status: this._status, body: data, headers: this.headers }); },
            end(data) { resolve({ status: this._status, body: data, headers: this.headers }); },
            redirect(code, url) { resolve({ status: code, body: undefined, headers: { ...this.headers, Location: url } }); },
        };
        let i = 0;
        const next = (err) => {
            if (err) return resolve({ status: err.statusCode ?? 500, error: err });
            const handler = route.handlers[i++];
            if (!handler) return resolve({ error: new Error('no handler responded') });
            handler(req, res, next);
        };
        next();
    });
}

/** In-memory Payload Local API: find/findByID/count/create/update/delete with equals/in/exists/and/or. */
export function fakePayload(initial = {}) {
    const data = structuredClone(initial);
    let nextId = 500;
    let tick = 0;
    // Real time, but strictly increasing, so "edited after" comparisons are deterministic.
    const now = () => new Date(Date.now() + (++tick) * 1000).toISOString();
    const rows = (c) => (data[c] = data[c] || []);
    const matches = (row, where = {}) => Object.entries(where).every(([key, cond]) => {
        if (key === 'and') return cond.every((c) => matches(row, c));
        if (key === 'or') return cond.some((c) => matches(row, c));
        if ('equals' in cond) return String(row[key]) === String(cond.equals);
        if ('in' in cond) return cond.in.map(String).includes(String(row[key]));
        if ('exists' in cond) return (row[key] != null) === cond.exists;
        return false;
    });
    const byId = (c, id) => rows(c).find((d) => String(d.id) === String(id)) || null;

    return {
        rows: data,
        async findByID({ collection, id }) { return byId(collection, id); },
        async find({ collection, where, sort, limit }) {
            let docs = rows(collection).filter((d) => matches(d, where));
            if (sort) {
                const desc = sort.startsWith('-');
                const key = desc ? sort.slice(1) : sort;
                docs.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
            }
            return { docs: limit ? docs.slice(0, limit) : docs, totalDocs: docs.length };
        },
        async count({ collection, where }) {
            return { totalDocs: rows(collection).filter((d) => matches(d, where)).length };
        },
        async create({ collection, data: fields }) {
            const stamp = now();
            const doc = { id: nextId++, createdAt: stamp, updatedAt: stamp, ...fields };
            rows(collection).push(doc);
            return doc;
        },
        async update({ collection, id, where, data: fields }) {
            if (id == null) { // by `where`, like Payload: { docs } of what was updated
                const docs = rows(collection).filter((d) => matches(d, where));
                docs.forEach((d) => Object.assign(d, fields, { updatedAt: now() }));
                return { docs };
            }
            const doc = byId(collection, id);
            if (!doc) throw new Error('not found');
            return Object.assign(doc, fields, { updatedAt: now() });
        },
        async delete({ collection, id, where }) {
            data[collection] = rows(collection).filter((d) => (id != null ? String(d.id) !== String(id) : !matches(d, where)));
        },
    };
}
