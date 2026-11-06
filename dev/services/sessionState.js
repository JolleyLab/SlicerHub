/**
 * Session details from /api/auth/me that several components need (the user menu's
 * "Start procedure mode", the procedure banner) without threading props through every
 * page. Set by the app shell; components listen for `session-state-changed`.
 */

let current = {
    procedureSettings: { enabled: false, defaultHours: 8, maxHours: 24 },
    procedureMode: { active: false },
};

export function getSessionState() {
    return current;
}

export function setSessionState(patch) {
    current = { ...current, ...patch };
    window.dispatchEvent(new CustomEvent('session-state-changed', { detail: current }));
}

/** True when the user menu should offer "Start procedure mode". */
export function canStartProcedureMode(state = current) {
    return Boolean(state.procedureSettings?.enabled) && !state.procedureMode?.active;
}
