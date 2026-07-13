import { endSession, getSession, listExpiredSessions } from './leaseRegistry.js';
import { getWatchdogIntervalMs } from './config.js';
import { slicerGuiProvider } from './providers/slicerGui.js';
import { trameProvider } from './providers/trame.js';

/** @type {Map<string, { kind: string, stop: Function, listOrphans?: Function }>} */
const providers = new Map([
    [slicerGuiProvider.kind, slicerGuiProvider],
    [trameProvider.kind, trameProvider]
]);

let timer = null;

export function getSessionProvider(kind) {
    const provider = providers.get(kind);
    if (!provider) {
        throw new Error(`Unknown viewer session provider: ${kind}`);
    }
    return provider;
}

export function registerSessionProvider(provider) {
    providers.set(provider.kind, provider);
}

export async function pruneExpiredViewerSessions() {
    const expired = listExpiredSessions();
    for (const { kind, sessionKey, sessionToken } of expired) {
        try {
            if (endSession(kind, sessionKey, sessionToken)) {
                const provider = getSessionProvider(kind);
                await provider.stop({ sessionKey, sessionToken });
                console.log(`Stopped expired ${kind} viewer session for ${sessionKey}`);
            }
        } catch (err) {
            console.warn(`Failed to stop expired ${kind} session for ${sessionKey}:`, err.message);
        }
    }

    for (const provider of providers.values()) {
        const orphans = await provider.listOrphans?.() || [];
        for (const orphan of orphans) {
            if (!getSession(provider.kind, orphan.sessionKey)) {
                try {
                    await provider.stop({ sessionKey: orphan.sessionKey });
                    console.log(`Stopped orphaned ${provider.kind} container for ${orphan.sessionKey}`);
                } catch (err) {
                    console.warn(
                        `Failed to stop orphaned ${provider.kind} container for ${orphan.sessionKey}:`,
                        err.message
                    );
                }
            }
        }
    }
}

export function startViewerSessionWatchdog() {
    if (timer) return;

    const intervalMs = getWatchdogIntervalMs();
    timer = setInterval(() => {
        pruneExpiredViewerSessions().catch((err) => {
            console.error('Viewer session watchdog error:', err.message || err);
        });
    }, intervalMs);

    if (timer.unref) {
        timer.unref();
    }

    console.log(`Viewer session watchdog started (${Math.round(intervalMs / 1000)}s interval)`);
}
