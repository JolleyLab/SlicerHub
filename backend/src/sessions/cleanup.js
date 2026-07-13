import { SESSION_KINDS } from './kinds.js';
import { clearSession } from './leaseRegistry.js';
import { stopSlicerGuiContainer } from './providers/slicerGui.js';
import { stopLocalTrameViewerSession } from './providers/trame.js';

/**
 * Stop all local viewer containers for a user (Trame + Full Slicer).
 * Does not stop remote/Vast trame sessions or GPU billing — intentional so
 * multiple project members can share a Vast instance independently.
 */
export async function cleanupLocalViewerSessionsForUser(userId) {
    const sessionKey = String(userId);
    const result = {
        userId: sessionKey,
        trame: null,
        slicerGui: null
    };

    clearSession(SESSION_KINDS.SLICER_GUI, sessionKey);
    try {
        result.slicerGui = await stopSlicerGuiContainer({ sessionKey });
    } catch (err) {
        result.slicerGui = { stopped: false, error: err.message };
        console.warn(`Local Full Slicer cleanup for user ${sessionKey}:`, err.message);
    }

    clearSession(SESSION_KINDS.TRAME, sessionKey);
    try {
        result.trame = await stopLocalTrameViewerSession({ sessionKey });
    } catch (err) {
        result.trame = { stopped: false, error: err.message };
        console.warn(`Local Trame cleanup for user ${sessionKey}:`, err.message);
    }

    const anyStopped = result.trame?.stopped || result.slicerGui?.stopped;
    if (anyStopped) {
        console.log(`Cleaned up local viewer sessions for user ${sessionKey}`, result);
    }

    return result;
}
