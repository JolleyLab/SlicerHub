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

test('blocks lower role (user blocked by org-admin guard)', async () => {
    await assert.rejects(run(requireRole('org-admin'), makeReq('user')));
});

test('blocks user from admin guard', async () => {
    await assert.rejects(run(requireRole('admin'), makeReq('user')));
});

test('blocks org-admin from admin guard', async () => {
    await assert.rejects(run(requireRole('admin'), makeReq('org-admin')));
});

test('blocks unknown role string', async () => {
    await assert.rejects(run(requireRole('user'), makeReq('superuser')));
});

// --- unauthenticated ---

test('blocks request with no user', async () => {
    await assert.rejects(run(requireRole('user'), makeReq(undefined)));
});

test('blocks request with null role', async () => {
    await assert.rejects(run(requireRole('user'), makeReq(null)));
});
