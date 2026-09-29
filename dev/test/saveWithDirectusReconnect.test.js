import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveWithDirectusReconnect } from '../services/directusRetry.js';

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
    beforeEach(() => {
        // Ensure no lingering listeners between tests
        vi.restoreAllMocks();
    });

    it('resolves with the return value when saveFn succeeds immediately', async () => {
        const saveFn = vi.fn().mockResolvedValue({ id: 42 });
        const result = await saveWithDirectusReconnect(saveFn);
        expect(result).toEqual({ id: 42 });
        expect(saveFn).toHaveBeenCalledTimes(1);
    });

    it('propagates non-session errors unchanged without waiting for reconnect', async () => {
        const networkErr = new Error('Network failure');
        networkErr.code = 'NETWORK_ERROR';
        const saveFn = vi.fn().mockRejectedValue(networkErr);

        await expect(saveWithDirectusReconnect(saveFn)).rejects.toThrow('Network failure');
        expect(saveFn).toHaveBeenCalledTimes(1);
    });

    it('propagates errors with no code unchanged', async () => {
        const err = new Error('Something broke');
        const saveFn = vi.fn().mockRejectedValue(err);

        await expect(saveWithDirectusReconnect(saveFn)).rejects.toThrow('Something broke');
        expect(saveFn).toHaveBeenCalledTimes(1);
    });

    it('retries and resolves after directus-session-restored for DIRECTUS_SESSION_EXPIRED', async () => {
        const saveFn = vi.fn()
            .mockRejectedValueOnce(sessionExpiredError())
            .mockResolvedValueOnce({ saved: true });

        dispatchAfter('directus-session-restored');
        const result = await saveWithDirectusReconnect(saveFn);

        expect(result).toEqual({ saved: true });
        expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('retries and resolves after directus-session-restored for DIRECTUS_SESSION_REQUIRED', async () => {
        const saveFn = vi.fn()
            .mockRejectedValueOnce(sessionRequiredError())
            .mockResolvedValueOnce({ saved: true });

        dispatchAfter('directus-session-restored');
        const result = await saveWithDirectusReconnect(saveFn);

        expect(result).toEqual({ saved: true });
        expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('rejects with the original session error when reconnect is cancelled', async () => {
        const expiredErr = sessionExpiredError();
        const saveFn = vi.fn().mockRejectedValueOnce(expiredErr);

        dispatchAfter('directus-session-reconnect-cancelled');
        await expect(saveWithDirectusReconnect(saveFn)).rejects.toBe(expiredErr);
        expect(saveFn).toHaveBeenCalledTimes(1);
    });

    it('propagates a save error that occurs after successful reconnect', async () => {
        const retryErr = new Error('Conflict on save');
        const saveFn = vi.fn()
            .mockRejectedValueOnce(sessionExpiredError())
            .mockRejectedValueOnce(retryErr);

        dispatchAfter('directus-session-restored');
        await expect(saveWithDirectusReconnect(saveFn)).rejects.toThrow('Conflict on save');
        expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('cleans up event listeners after resolution so they do not fire again', async () => {
        const saveFn = vi.fn()
            .mockRejectedValueOnce(sessionExpiredError())
            .mockResolvedValue({ saved: true });

        dispatchAfter('directus-session-restored');
        await saveWithDirectusReconnect(saveFn);

        // A second restore event after completion should not call saveFn again
        window.dispatchEvent(new Event('directus-session-restored'));
        await Promise.resolve();
        expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('cleans up event listeners after cancellation so they do not fire again', async () => {
        const saveFn = vi.fn().mockRejectedValueOnce(sessionExpiredError());

        dispatchAfter('directus-session-reconnect-cancelled');
        await saveWithDirectusReconnect(saveFn).catch(() => {});

        // A restore event after cancellation should not call saveFn again
        window.dispatchEvent(new Event('directus-session-restored'));
        await Promise.resolve();
        expect(saveFn).toHaveBeenCalledTimes(1);
    });
});
