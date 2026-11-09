import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Full Slicer copies case files into the person's seat folder. When access to a case ends,
// its copies go and the seat holding them is stopped (slicerGui/caseAccessGuard.js).

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-guard-'));
const seatDir = (userId, seatId) => path.join(root, String(userId), `seat${seatId}`);
const attachments = new Map([[11, 'case-a'], [12, 'case-b']]); // attachment id -> case id
let canOpen = new Set(['case-a', 'case-b']); // cases the user may open
let payloadDown = false;
const stopped = [];

mock.module('../../../backend/src/slicerGui/paths.js', {
    namedExports: { slicerGuiUserDir: seatDir, getSlicerGuiMaxSeatsPerUser: () => 2 },
});
mock.module('../../../backend/src/slicerGui/sessionManager.js', {
    namedExports: { stopSlicerGuiSession: async ({ userId, seatId }) => { stopped.push(`${userId}:${seatId}`); } },
});
mock.module('../../../backend/src/utils/caseAccess.js', {
    namedExports: { getCaseRoleForSub: async (doc) => (canOpen.has(doc.id) ? 'read_only' : null) },
});
mock.module('../../../backend/src/payload/index.js', {
    namedExports: {
        getPayloadClient: () => ({
            find: async ({ where }) => {
                if (payloadDown) throw new Error('db down');
                return { docs: where.id.in.filter((id) => attachments.has(id)).map((id) => ({ id, case: attachments.get(id) })) };
            },
            findByID: async ({ id }) => ({ id }),
        }),
    },
});

const { removeCopiesWithoutAccess, enforceCaseAccessOnAllSeats, enforceCaseAccessOnHeartbeat } =
    await import('../../../backend/src/slicerGui/caseAccessGuard.js');

const user = { id: 'u1', keycloakSub: 'sub-1', role: 'user' };
function stage(seatId, names) {
    const dir = seatDir(user.id, seatId);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
}
const left = (seatId) => fs.readdirSync(seatDir(user.id, seatId)).sort();

test.beforeEach(() => { stopped.length = 0; canOpen = new Set(['case-a', 'case-b']); payloadDown = false; });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('copies from cases the person can still open stay', async () => {
    stage(1, ['pl-11-a.nrrd', 'pl-12-b.mrb', '.last-loaded.json']);
    const r = await removeCopiesWithoutAccess({ user, seatId: 1 });
    assert.deepEqual(r, { removed: [], lostCaseIds: [] });
    assert.deepEqual(left(1), ['.last-loaded.json', 'pl-11-a.nrrd', 'pl-12-b.mrb']);
});

test('removed from a case: its copies go, other files stay', async () => {
    stage(1, ['pl-11-a.nrrd', 'pl-12-b.mrb', 'slicer-session.log']);
    canOpen.delete('case-b');
    const r = await removeCopiesWithoutAccess({ user, seatId: 1 });
    assert.deepEqual(r.lostCaseIds, ['case-b']);
    assert.deepEqual(left(1), ['pl-11-a.nrrd', 'slicer-session.log']);
});

test('a deleted file (or case) counts as gone too', async () => {
    stage(1, ['pl-99-gone.nrrd']);
    const r = await removeCopiesWithoutAccess({ user, seatId: 1 });
    assert.deepEqual(r.removed, ['pl-99-gone.nrrd']);
    assert.equal(r.lostCaseIds.length, 1);
});

test('if the lookup fails, nothing is deleted', async () => {
    stage(1, ['pl-11-a.nrrd']);
    payloadDown = true;
    canOpen.clear();
    assert.deepEqual(await removeCopiesWithoutAccess({ user, seatId: 1 }), { removed: [], lostCaseIds: [] });
    assert.deepEqual(left(1), ['pl-11-a.nrrd']);
});

test('site admins can open every case: their copies are never removed', async () => {
    stage(1, ['pl-11-a.nrrd']);
    canOpen.clear();
    const r = await removeCopiesWithoutAccess({ user: { ...user, role: 'admin' }, seatId: 1 });
    assert.deepEqual(r.removed, []);
});

test('before opening a file: every seat is cleaned, and only seats that held lost copies stop', async () => {
    stage(1, ['pl-11-a.nrrd']);
    stage(2, ['pl-12-b.mrb']);
    canOpen.delete('case-b');
    await enforceCaseAccessOnAllSeats(user);
    assert.deepEqual(stopped, ['u1:2']);
    assert.deepEqual(left(1), ['pl-11-a.nrrd']);
    assert.deepEqual(left(2), []);
});

test('heartbeat: checks at most once a minute per seat, stops the seat when access ended', async () => {
    stage(1, ['pl-12-b.mrb']);
    assert.deepEqual(await enforceCaseAccessOnHeartbeat(user, 1), []);
    canOpen.delete('case-b');
    assert.deepEqual(await enforceCaseAccessOnHeartbeat(user, 1), [], 'within the minute: not rechecked');
    assert.deepEqual(stopped, []);
    // A different seat has its own clock.
    stage(2, ['pl-12-b.mrb']);
    assert.deepEqual(await enforceCaseAccessOnHeartbeat(user, 2), ['case-b']);
    assert.deepEqual(stopped, ['u1:2']);
});
