import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { saveWithDirectusReconnect } from '../../../dev/services/directusRetry.js';

// directusRetry.js uses `window` as a free variable; provide an EventTarget-backed mock.
globalThis.window = new EventTarget();

function sessionExpiredError() {
    const err = new Error('Session expired');
    err.code = 'DIRECTUS_SESSION_EXPIRED';
    return err;
}

function sessionRequiredError() {
    const err = new Error('Session required');
    err.code = 'DIRECTUS_SESSION_REQUIRED';
    return err;
}

function dispatchAfter(eventName, ms = 0) {
    setTimeout(() => window.dispatchEvent(new Event(eventName)), ms);
}

describe('saveWithDirectusReconnect', () => {
    it('resolves with the return value when saveFn succeeds immediately', async () => {
        let calls = 0;
        const saveFn = async () => { calls++; return { id: 42 }; };
        const result = await saveWithDirectusReconnect(saveFn);
        assert.deepEqual(result, { id: 42 });
        assert.equal(calls, 1);
    });

    it('propagates non-session errors unchanged without waiting for reconnect', async () => {
        const networkErr = new Error('Network failure');
        networkErr.code = 'NETWORK_ERROR';
        let calls = 0;
        const saveFn = async () => { calls++; throw networkErr; };
        await assert.rejects(() => saveWithDirectusReconnect(saveFn), { message: 'Network failure' });
        assert.equal(calls, 1);
    });

    it('propagates errors with no code unchanged', async () => {
        let calls = 0;
        const saveFn = async () => { calls++; throw new Error('Something broke'); };
        await assert.rejects(() => saveWithDirectusReconnect(saveFn), { message: 'Something broke' });
        assert.equal(calls, 1);
    });

    it('retries and resolves after directus-session-restored for DIRECTUS_SESSION_EXPIRED', async () => {
        let calls = 0;
        const saveFn = async () => {
            if (++calls === 1) throw sessionExpiredError();
            return { saved: true };
        };
        dispatchAfter('directus-session-restored');
        const result = await saveWithDirectusReconnect(saveFn);
        assert.deepEqual(result, { saved: true });
        assert.equal(calls, 2);
    });

    it('retries and resolves after directus-session-restored for DIRECTUS_SESSION_REQUIRED', async () => {
        let calls = 0;
        const saveFn = async () => {
            if (++calls === 1) throw sessionRequiredError();
            return { saved: true };
        };
        dispatchAfter('directus-session-restored');
        const result = await saveWithDirectusReconnect(saveFn);
        assert.deepEqual(result, { saved: true });
        assert.equal(calls, 2);
    });

    it('rejects with the original session error when reconnect is cancelled', async () => {
        const expiredErr = sessionExpiredError();
        let calls = 0;
        const saveFn = async () => { calls++; throw expiredErr; };
        dispatchAfter('directus-session-reconnect-cancelled');
        await assert.rejects(() => saveWithDirectusReconnect(saveFn), expiredErr);
        assert.equal(calls, 1);
    });

    it('propagates a save error that occurs after successful reconnect', async () => {
        let calls = 0;
        const saveFn = async () => {
            if (++calls === 1) throw sessionExpiredError();
            throw new Error('Conflict on save');
        };
        dispatchAfter('directus-session-restored');
        await assert.rejects(() => saveWithDirectusReconnect(saveFn), { message: 'Conflict on save' });
        assert.equal(calls, 2);
    });

    it('cleans up event listeners after resolution so they do not fire again', async () => {
        let calls = 0;
        const saveFn = async () => {
            if (++calls === 1) throw sessionExpiredError();
            return { saved: true };
        };
        dispatchAfter('directus-session-restored');
        await saveWithDirectusReconnect(saveFn);
        // A second restore after completion should not re-invoke saveFn
        window.dispatchEvent(new Event('directus-session-restored'));
        await Promise.resolve();
        assert.equal(calls, 2);
    });

    it('cleans up event listeners after cancellation so they do not fire again', async () => {
        let calls = 0;
        const saveFn = async () => { calls++; throw sessionExpiredError(); };
        dispatchAfter('directus-session-reconnect-cancelled');
        await saveWithDirectusReconnect(saveFn).catch(() => {});
        // A restore after cancellation should not re-invoke saveFn
        window.dispatchEvent(new Event('directus-session-restored'));
        await Promise.resolve();
        assert.equal(calls, 1);
    });
});
