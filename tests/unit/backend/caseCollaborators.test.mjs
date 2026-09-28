import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Importing the service pulls in the app config; keep any database it opens in a scratch file.
const scratchDb = path.join(os.tmpdir(), `case-collaborators-test-${process.pid}.db`);
process.env.DB_PATH = scratchDb;
process.env.DB_SEED_PATH = `${scratchDb}.no-seed`;
test.after(() => fs.rmSync(scratchDb, { force: true }));

const {
    createCaseCollaborators,
    parseCaseRole,
    requestedCaseRole,
    CASE_COLLAB_ROLES
} = await import('../../../backend/src/services/caseCollaborators.js');

const CASE = 'case-1';
const ADMIN = 'user-admin';
const COLLAB = 'user-collab';
const READER = 'user-reader';
const NEWBIE = 'user-new';

/** In-memory Directus: the case_directus_users junction and one readable case. */
function fakeDirectus(initial) {
    let nextId = initial.length + 1;
    const rows = initial.map(([id, userId, role], i) => ({ id: i + 1, case_id: CASE, directus_users_id: userId, role }));
    const ops = [];
    const fetchDirectus = async (route, { method = 'GET', query, body } = {}) => {
        if (route.startsWith('/items/case/')) return { data: { id: CASE, title: 'Cardiac CT' } };
        assert.ok(route.startsWith('/items/case_directus_users'), `unexpected route ${route}`);
        if (method === 'GET') {
            const ids = String(query['filter[case_id][_in]']).split(',');
            return {
                data: rows
                    .filter((r) => ids.includes(r.case_id))
                    .map((r) => ({ ...r, directus_users_id: { id: r.directus_users_id, email: `${r.directus_users_id}@x.org`, first_name: null, last_name: null } }))
            };
        }
        if (method === 'POST') {
            const row = { id: nextId++, ...body };
            rows.push(row);
            ops.push(`create:${body.directus_users_id}:${body.role}`);
            return { data: row };
        }
        const id = Number(route.split('/').pop());
        const row = rows.find((r) => r.id === id);
        if (method === 'PATCH') {
            row.role = body.role;
            ops.push(`update:${row.directus_users_id}:${body.role}`);
            return { data: row };
        }
        rows.splice(rows.indexOf(row), 1);
        ops.push(`delete:${row.directus_users_id}`);
        return { data: null };
    };
    return { service: createCaseCollaborators({ fetchDirectus }), rows, ops };
}

const standard = () => fakeDirectus([
    [1, ADMIN, 'admin'],
    [2, COLLAB, 'collaborator'],
    [3, READER, 'read_only']
]);
const as = (actor) => ({ accessToken: 't', actorDirectusUserId: actor });
const roleOf = (members, id) => members.find((m) => m.id === id)?.role;

test('a stored role is exactly one of the three values; anything else is nothing', () => {
    assert.equal(parseCaseRole('admin'), 'admin');
    assert.equal(parseCaseRole('read_only'), 'read_only');
    for (const bad of [null, undefined, '', 'superuser', 'readonly', 'ADMIN', 1, ['0'], ['admin']]) {
        assert.equal(parseCaseRole(bad), null, JSON.stringify(bad));
    }
});

test('a requested role defaults to collaborator, accepts readonly, and rejects anything else', () => {
    assert.equal(requestedCaseRole(undefined), 'collaborator');
    assert.equal(requestedCaseRole('readonly'), 'read_only');
    assert.equal(requestedCaseRole('Read-Only'), 'read_only');
    assert.throws(() => requestedCaseRole('superuser'), (err) => err.statusCode === 400);
});

test('the actor context reports the actor role from the junction', async () => {
    const { service } = standard();
    const admin = await service.getCaseCollabActorContext(CASE, as(ADMIN));
    assert.equal(admin.actorIsAdmin, true);
    assert.equal(admin.actorCanInvite, true);
    assert.equal(admin.caseTitle, 'Cardiac CT');
    const reader = await service.getCaseCollabActorContext(CASE, as(READER));
    assert.equal(reader.actorIsAdmin, false);
    assert.equal(reader.actorCanInvite, false);
    const stranger = await service.getCaseCollabActorContext(CASE, as('someone-else'));
    assert.equal(stranger.actorRole, null);
    assert.equal(stranger.actorCanInvite, false);
});

test('a junction row with an unrecognised role grants nothing and is listed as read only', async () => {
    const { service } = fakeDirectus([[1, ADMIN, 'admin'], [2, COLLAB, 'superuser']]);
    const ctx = await service.getCaseCollabActorContext(CASE, as(COLLAB));
    assert.equal(ctx.actorRole, null);
    assert.equal(ctx.actorCanInvite, false);
    assert.equal(ctx.actorIsAdmin, false);
    assert.equal(roleOf(ctx.existingList, COLLAB), 'read_only');
});

test('nobody is an owner just for creating the case: only the junction role counts', async () => {
    const { service } = fakeDirectus([[1, COLLAB, 'collaborator']]);
    const ctx = await service.getCaseCollabActorContext(CASE, as(COLLAB));
    assert.equal(ctx.actorIsAdmin, false);
    assert.equal('ownerId' in ctx, false);
});

test('a case creator becomes an ordinary admin row, without duplicating one that exists', async () => {
    const { service, rows, ops } = fakeDirectus([]);
    await service.addCaseCreatorAsAdmin(CASE, ADMIN);
    await service.addCaseCreatorAsAdmin(CASE, ADMIN);
    assert.deepEqual(rows.map((r) => [r.directus_users_id, r.role]), [[ADMIN, 'admin']]);
    assert.deepEqual(ops, [`create:${ADMIN}:admin`]);
});

test('only an admin can add a collaborator directly', async () => {
    const { service, rows } = standard();
    await assert.rejects(service.addCaseCollaborator(CASE, NEWBIE, 'collaborator', as(COLLAB)), (err) => err.statusCode === 403);
    assert.equal(rows.length, 3);
    const result = await service.addCaseCollaborator(CASE, NEWBIE, 'read_only', as(ADMIN));
    assert.equal(roleOf(result.collaborators, NEWBIE), 'read_only');
});

test('adding someone already on the case changes their role instead of duplicating them', async () => {
    const { service, rows } = standard();
    await service.addCaseCollaborator(CASE, READER, 'collaborator', as(ADMIN));
    assert.equal(rows.filter((r) => r.directus_users_id === READER).length, 1);
    assert.equal(rows.find((r) => r.directus_users_id === READER).role, 'collaborator');
});

test('an admin can add, change and remove people in one save', async () => {
    const { service, rows } = standard();
    const result = await service.setCaseCollaborators(CASE, [
        { userId: ADMIN, role: 'admin' },
        { userId: COLLAB, role: 'read_only' },
        { userId: NEWBIE, role: 'collaborator' }
    ], as(ADMIN));
    assert.deepEqual(rows.map((r) => [r.directus_users_id, r.role]).sort(), [
        [ADMIN, 'admin'], [COLLAB, 'read_only'], [NEWBIE, 'collaborator']
    ].sort());
    assert.equal(roleOf(result.collaborators, READER), undefined);
});

test('adds and role changes are written before removals', async () => {
    const { service, ops } = standard();
    await service.setCaseCollaborators(CASE, [
        { userId: ADMIN, role: 'admin' },
        { userId: NEWBIE, role: 'admin' }
    ], as(ADMIN));
    const firstDelete = ops.findIndex((op) => op.startsWith('delete:'));
    assert.ok(firstDelete > ops.indexOf(`create:${NEWBIE}:admin`));
});

test('swapping the admin writes the promotion before the demotion', async () => {
    const { service, ops } = standard();
    await service.setCaseCollaborators(CASE, [
        { userId: ADMIN, role: 'collaborator' },
        { userId: COLLAB, role: 'admin' },
        { userId: READER, role: 'read_only' }
    ], as(ADMIN));
    assert.ok(ops.indexOf(`update:${COLLAB}:admin`) < ops.indexOf(`update:${ADMIN}:collaborator`), ops.join(' '));
});

test('a case always keeps an admin: a save with none is refused and writes nothing', async () => {
    const { service, rows, ops } = standard();
    await assert.rejects(
        service.setCaseCollaborators(CASE, [{ userId: ADMIN, role: 'collaborator' }, { userId: COLLAB, role: 'collaborator' }], as(ADMIN)),
        (err) => err.statusCode === 400
    );
    await assert.rejects(service.setCaseCollaborators(CASE, [], as(ADMIN)), (err) => err.statusCode === 400);
    assert.deepEqual(ops, []);
    assert.equal(rows.length, 3);
});

test('a collaborator cannot change or remove people, or add through the People save', async () => {
    const { service, ops } = standard();
    const keep = [{ userId: ADMIN, role: 'admin' }, { userId: COLLAB, role: 'collaborator' }, { userId: READER, role: 'read_only' }];
    await assert.rejects(service.setCaseCollaborators(CASE, keep.slice(0, 2), as(COLLAB)), (err) => err.statusCode === 403);
    await assert.rejects(service.setCaseCollaborators(CASE, [{ ...keep[0] }, { userId: COLLAB, role: 'read_only' }, keep[2]], as(COLLAB)), (err) => err.statusCode === 403);
    await assert.rejects(service.setCaseCollaborators(CASE, [...keep, { userId: NEWBIE, role: 'collaborator' }], as(COLLAB)), (err) => err.statusCode === 403);
    assert.deepEqual(ops, []);
});

test('a read only member cannot change people at all', async () => {
    const { service, ops } = standard();
    await assert.rejects(service.setCaseCollaborators(CASE, [{ userId: ADMIN, role: 'admin' }], as(READER)), (err) => err.statusCode === 403);
    assert.deepEqual(ops, []);
});

test('a role a client sends that is not valid is rejected, not guessed', async () => {
    const { service, ops } = standard();
    await assert.rejects(
        service.setCaseCollaborators(CASE, [{ userId: ADMIN, role: 'admin' }, { userId: COLLAB, role: 'superuser' }], as(ADMIN)),
        (err) => err.statusCode === 400
    );
    assert.deepEqual(ops, []);
});

test('a system add (signup redeem) writes the role without an acting user', async () => {
    const { service, rows } = standard();
    const result = await service.addCaseCollaboratorAsSystem(CASE, NEWBIE, 'read_only');
    assert.equal(roleOf(result.collaborators, NEWBIE), 'read_only');
    assert.equal(rows.length, 4);
    assert.equal(CASE_COLLAB_ROLES.READ_ONLY, 'read_only');
});
