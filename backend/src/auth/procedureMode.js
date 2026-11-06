/**
 * Procedure mode: keep a theatre workstation signed in for a long case.
 * docs/redirect-login-and-sessions-design.md ("Procedure mode").
 *
 *   - started by the signed-in user, with a fresh password and an acknowledgment
 *     every time;
 *   - a number of hours (default PROCEDURE_MODE_DEFAULT_HOURS) or "until I end it",
 *     never beyond PROCEDURE_MODE_MAX_HOURS, itself capped at 24 h in config;
 *   - while active: no idle timeout and no 12 h limit; when time runs out the session
 *     ends (the workstation is not left signed in).
 */

import config from '../config/index.js';
import { ValidationError, ForbiddenError } from '../utils/errors.js';

const HOUR_MS = 60 * 60 * 1000;

/** Public settings for the SPA. */
export function procedureModeSettings() {
    const { enabled, defaultHours, maxHours } = config.procedureMode;
    return { enabled, defaultHours, maxHours };
}

/**
 * Validate a start request and work out when it ends.
 * @param {{ hours?: number|string, untilEnded?: boolean, acknowledged?: boolean }} request
 * @returns {{ procedureUntil: string, procedureOpenEnded: boolean, hours: number }}
 */
export function resolveProcedureRequest(request = {}, now = Date.now()) {
    const { enabled, defaultHours, maxHours } = config.procedureMode;
    if (!enabled) {
        throw new ForbiddenError('Procedure mode is turned off on this server', 'PROCEDURE_MODE_DISABLED', 'auth.procedure_mode_disabled');
    }
    if (request.acknowledged !== true) {
        throw new ValidationError('Please confirm you understand how procedure mode works', 'PROCEDURE_MODE_ACK_REQUIRED', 'auth.procedure_mode_ack_required');
    }
    const openEnded = request.untilEnded === true;
    let hours = openEnded ? maxHours : Number(request.hours ?? defaultHours);
    if (!Number.isFinite(hours) || hours <= 0) hours = defaultHours;
    hours = Math.min(maxHours, Math.max(1, Math.round(hours)));
    return {
        procedureUntil: new Date(now + hours * HOUR_MS).toISOString(),
        procedureOpenEnded: openEnded,
        hours,
    };
}

/** Compact form carried through the redirect-login transaction cookie. */
export function procedureIntentFromQuery(query = {}) {
    const raw = String(query.procedure || '').trim();
    if (!raw) return null;
    return {
        untilEnded: raw === 'open',
        hours: raw === 'open' ? undefined : Number(raw),
        acknowledged: query.ack === '1' || query.ack === 'true',
    };
}
