import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../../../backend/src/auth/requireRole.js';

function makeReq(role) {
    return { user: role !== undefined ? { role } : undefined };
}

function run(middleware, req) {
    return new Promise((resolve, reject) => {
        middleware(req, {}, err => (err ? reject(err) : resolve()));
    });
}

// --- passes ---

test('allows exact role match', async () => {
    await assert.doesNotReject(run(requireRole('user'), makeReq('user')));
});

test('allows higher role (admin passes org-admin guard)', async () => {
    await assert.doesNotReject(run(requireRole('org-admin'), makeReq('admin')));
});

test('allows admin on user guard', async () => {
    await assert.doesNotReject(run(requireRole('user'), makeReq('admin')));
});

// --- blocks ---
// Each "blocks" case must reject specifically with a 403 Forbidden — a guard that rejected
// everything (including the "allows" cases above) for the wrong reason would still pass
// assert.rejects() with no validator, so the status code is checked explicitly.

test('blocks lower role (user blocked by org-admin guard)', async () => {
    await assert.rejects(run(requireRole('org-admin'), makeReq('user')), (err) => err.statusCode === 403);
});

test('blocks user from admin guard', async () => {
    await assert.rejects(run(requireRole('admin'), makeReq('user')), (err) => err.statusCode === 403);
});

test('blocks org-admin from admin guard', async () => {
    await assert.rejects(run(requireRole('admin'), makeReq('org-admin')), (err) => err.statusCode === 403);
});

test('blocks unknown role string', async () => {
    await assert.rejects(run(requireRole('user'), makeReq('superuser')), (err) => err.statusCode === 403);
});

// --- unauthenticated ---
// No req.user is a distinct failure (401, not logged in) from a known-but-insufficient role
// (403, logged in but not allowed). A guard that collapsed these would still pass loose rejects().

test('blocks request with no user as 401, not 403', async () => {
    await assert.rejects(run(requireRole('user'), makeReq(undefined)), (err) => err.statusCode === 401);
});

test('blocks request with null role as 403 (authenticated, but no usable role), not 401', async () => {
    await assert.rejects(run(requireRole('user'), makeReq(null)), (err) => err.statusCode === 403);
});
