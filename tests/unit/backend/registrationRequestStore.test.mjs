import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// CRUD functions call getPayloadClient() internally (no dependency injection), so a fake
// Payload client is substituted before import.
let payloadClient = null;
mock.module('../../../backend/src/payload/index.js', {
    namedExports: { getPayloadClient: () => payloadClient }
});

const {
    toRegistrationRequestDTO: mapRequest,
    REG_STATUS,
    findOpenByEmail,
    listRecentlyDecided,
    listPending,
    getById,
    rejectRequest,
} = await import('../../../backend/src/services/registrationRequestStore.js');

/** A fake Payload client over one in-memory `registration-requests` collection. */
function fakePayload(rows = []) {
    const calls = [];
    let nextId = 1000;
    for (const r of rows) nextId = Math.max(nextId, Number(r.id) + 1);
    const matches = (row, where) => {
        if (where.and) return where.and.every((c) => matches(row, c));
        const [key, cond] = Object.entries(where)[0];
        if ('equals' in cond) return row[key] === cond.equals;
        if ('in' in cond) return cond.in.includes(row[key]);
        if ('greater_than_equal' in cond) return row[key] >= cond.greater_than_equal;
        throw new Error(`unsupported condition ${JSON.stringify(cond)}`);
    };
    return {
        calls,
        rows,
        async find({ where, sort, limit }) {
            calls.push({ op: 'find', where, sort, limit });
            let docs = where ? rows.filter((r) => matches(r, where)) : [...rows];
            if (sort) {
                const desc = sort.startsWith('-');
                const key = desc ? sort.slice(1) : sort;
                docs = [...docs].sort((a, b) => {
                    const cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
                    return desc ? -cmp : cmp;
                });
            }
            return { docs: docs.slice(0, limit ?? docs.length) };
        },
        async findByID({ id }) {
            calls.push({ op: 'findByID', id });
            const doc = rows.find((r) => String(r.id) === String(id));
            if (!doc) throw new Error('not found');
            return doc;
        },
        async create({ data }) {
            calls.push({ op: 'create', data });
            const doc = { id: nextId++, createdAt: '2026-01-01T00:00:00Z', ...data };
            rows.push(doc);
            return doc;
        },
        async update({ id, data }) {
            calls.push({ op: 'update', id, data });
            const doc = rows.find((r) => String(r.id) === String(id));
            if (!doc) throw new Error('not found');
            Object.assign(doc, data);
            return doc;
        }
    };
}

test.beforeEach(() => {
    payloadClient = null;
});

test('REG_STATUS has correct values', () => {
    assert.equal(REG_STATUS.PENDING,   'pending');
    assert.equal(REG_STATUS.APPROVED,  'approved');
    assert.equal(REG_STATUS.REJECTED,  'rejected');
    assert.equal(REG_STATUS.COMPLETED, 'completed');
});

test('REG_STATUS is frozen', () => {
    assert.throws(() => { REG_STATUS.PENDING = 'mutated'; }, TypeError);
});

test('mapRequest returns null for null input', () => {
    assert.equal(mapRequest(null), null);
});

test('mapRequest returns null for undefined input', () => {
    assert.equal(mapRequest(undefined), null);
});

test('mapRequest maps all standard fields', () => {
    const row = {
        id: 'abc-123',
        email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        affiliation: 'Queens University',
        intended_use: 'Clinical research',
        status: 'pending',
        is_org_admin: false,
        createdAt: '2026-01-15T10:00:00Z'
    };
    const result = mapRequest(row);
    assert.equal(result.id, 'abc-123');
    assert.equal(result.email, 'jane@example.com');
    assert.equal(result.firstName, 'Jane');
    assert.equal(result.lastName, 'Doe');
    assert.equal(result.affiliation, 'Queens University');
    assert.equal(result.intendedUse, 'Clinical research');
    assert.equal(result.status, 'pending');
    assert.equal(result.isOrgAdmin, false);
    assert.equal(result.createdAt, '2026-01-15T10:00:00Z');
});

test('mapRequest coerces id to string', () => {
    const result = mapRequest({ id: 42, email: 'x@x.com' });
    assert.equal(result.id, '42');
});

test('mapRequest sets isOrgAdmin true when is_org_admin is true', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com', is_org_admin: true });
    assert.equal(result.isOrgAdmin, true);
});

test('mapRequest sets isOrgAdmin false for null', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com', is_org_admin: null }).isOrgAdmin, false);
});

test('mapRequest sets isOrgAdmin false when field is absent', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).isOrgAdmin, false);
});

test('mapRequest defaults status to PENDING when absent', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.status, REG_STATUS.PENDING);
});

test('mapRequest defaults missing string fields to empty string', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.firstName, '');
    assert.equal(result.lastName, '');
    assert.equal(result.affiliation, '');
    assert.equal(result.intendedUse, '');
});

test('mapRequest sets createdAt to null when absent', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com' });
    assert.equal(result.createdAt, null);
});

test('mapRequest sets decidedAt from reviewed_at', () => {
    const result = mapRequest({ id: '1', email: 'a@b.com', reviewed_at: '2026-03-01T12:00:00Z' });
    assert.equal(result.decidedAt, '2026-03-01T12:00:00Z');
});

test('mapRequest sets decidedAt to null when reviewed_at is absent', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).decidedAt, null);
});

test('mapRequest sets reviewerName to null (resolved separately from Keycloak)', () => {
    assert.equal(mapRequest({ id: '1', email: 'a@b.com' }).reviewerName, null);
});

// ---------------------------------------------------------------------------
// findOpenByEmail
// ---------------------------------------------------------------------------

test('findOpenByEmail is case-insensitive and ignores rejected/completed requests', async () => {
    payloadClient = fakePayload([{ id: 1, email: 'jane@example.com', status: REG_STATUS.COMPLETED }]);
    assert.equal(await findOpenByEmail('JANE@EXAMPLE.COM'), null);
    payloadClient.rows[0].status = REG_STATUS.PENDING;
    assert.equal((await findOpenByEmail('JANE@EXAMPLE.COM')).email, 'jane@example.com');
});

// ---------------------------------------------------------------------------
// listPending / listRecentlyDecided
// ---------------------------------------------------------------------------

test('listPending returns only pending requests', async () => {
    payloadClient = fakePayload([
        { id: 1, email: 'a@x.com', status: REG_STATUS.PENDING },
        { id: 2, email: 'b@x.com', status: REG_STATUS.APPROVED }
    ]);
    const pending = await listPending();
    assert.deepEqual(pending.map((r) => r.id), ['1']);
});

test('listRecentlyDecided excludes pending requests and ones decided before the window', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    payloadClient = fakePayload([
        { id: 1, email: 'a@x.com', status: REG_STATUS.PENDING, reviewed_at: recent },
        { id: 2, email: 'b@x.com', status: REG_STATUS.APPROVED, reviewed_at: old },
        { id: 3, email: 'c@x.com', status: REG_STATUS.REJECTED, reviewed_at: recent }
    ]);
    const decided = await listRecentlyDecided(7);
    assert.deepEqual(decided.map((r) => r.id), ['3']);
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

test('getById returns null for a missing id instead of throwing', async () => {
    payloadClient = fakePayload();
    assert.equal(await getById('does-not-exist'), null);
});

test('getById maps a found row', async () => {
    payloadClient = fakePayload([{ id: 1, email: 'a@x.com', status: REG_STATUS.PENDING }]);
    assert.equal((await getById('1')).email, 'a@x.com');
});

// ---------------------------------------------------------------------------
// rejectRequest
// ---------------------------------------------------------------------------

test('rejectRequest records who rejected it and when', async () => {
    payloadClient = fakePayload([{ id: 1, email: 'a@x.com', status: REG_STATUS.PENDING }]);
    await rejectRequest('1', 'admin-sub');
    assert.equal(payloadClient.rows[0].status, REG_STATUS.REJECTED);
    assert.equal(payloadClient.rows[0].reviewed_by, 'admin-sub');
    assert.ok(payloadClient.rows[0].reviewed_at);
});
