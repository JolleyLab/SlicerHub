import test from 'node:test';
import assert from 'node:assert/strict';
import { requireKcGroupCapability } from '../../../backend/src/auth/requireKcGroupCapability.js';

const CAP = 'can_approve_registrations';

function makeReq(kcSub) {
    return { user: kcSub !== undefined ? { keycloakSub: kcSub } : undefined };
}

function run(middleware, req) {
    return new Promise((resolve, reject) => {
        middleware(req, {}, err => (err ? reject(err) : resolve()));
    });
}

const allow = async () => true;
const deny  = async () => false;

// ── passes ────────────────────────────────────────────────────────────────────

test('passes when checkFn returns true', async () => {
    await assert.doesNotReject(run(requireKcGroupCapability(CAP, allow), makeReq('sub-abc')));
});

// ── blocks ────────────────────────────────────────────────────────────────────

test('blocks when checkFn returns false', async () => {
    await assert.rejects(run(requireKcGroupCapability(CAP, deny), makeReq('sub-abc')));
});

test('blocks when keycloakSub is null', async () => {
    await assert.rejects(run(requireKcGroupCapability(CAP, allow), makeReq(null)));
});

test('blocks when keycloakSub is empty string', async () => {
    await assert.rejects(run(requireKcGroupCapability(CAP, allow), makeReq('')));
});

test('blocks when req.user is undefined', async () => {
    await assert.rejects(run(requireKcGroupCapability(CAP, allow), makeReq(undefined)));
});

// ── error propagation ─────────────────────────────────────────────────────────

test('passes the thrown error to next when checkFn throws', async () => {
    const boom = new Error('DB unavailable');
    const throws = async () => { throw boom; };
    await assert.rejects(
        run(requireKcGroupCapability(CAP, throws), makeReq('sub-abc')),
        err => err === boom
    );
});

// ── error shape ───────────────────────────────────────────────────────────────

test('blocked request rejects with a ForbiddenError (statusCode 403)', async () => {
    await assert.rejects(
        run(requireKcGroupCapability(CAP, deny), makeReq('sub-abc')),
        err => err.statusCode === 403
    );
});

test('missing sub rejects with a ForbiddenError (statusCode 403)', async () => {
    await assert.rejects(
        run(requireKcGroupCapability(CAP, allow), makeReq(null)),
        err => err.statusCode === 403
    );
});
