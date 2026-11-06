/**
 * Keeps a session's role in step with Keycloak.
 *
 * The app JWT carries the role from login time, and the idle window slides on every
 * request, so without this a user demoted (or disabled) in Keycloak would keep their
 * old rights for as long as they stay active. authenticateToken asks this module for
 * the current account state; Keycloak is consulted at most every REFRESH_MS per user.
 *
 * In-process cache, like the login rate limiter (single backend instance).
 */

import { getUserAccountState } from '../services/keycloakAdmin.js';
import { pickRole, hasAppAccess } from './providers/keycloak.js';

export const REFRESH_MS = 5 * 60 * 1000;
/** After a failed lookup, try again this soon instead of waiting the full interval. */
const RETRY_AFTER_FAILURE_MS = 30 * 1000;
const LOOKUP_TIMEOUT_MS = 5000;

/** @type {Map<string, { role: string|null, approved: boolean|null, active: boolean|null, notBefore: number, checkedAt: number }>} */
const cache = new Map();
/** @type {Map<string, Promise<void>>} */
const inflight = new Map();

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

async function refresh(kcSub, fetchState) {
    const now = Date.now();
    try {
        const state = await withTimeout(fetchState(kcSub), LOOKUP_TIMEOUT_MS);
        const active = Boolean(state?.exists && state?.enabled);
        cache.set(kcSub, {
            role: active ? pickRole(state.realmRoles) : null,
            approved: active ? hasAppAccess(state.realmRoles) : null,
            active,
            notBefore: Number(state?.notBefore) || 0,
            checkedAt: now,
        });
    } catch (err) {
        // Keycloak unreachable: keep the last known state (or "unknown") rather than
        // locking everyone out, and retry soon.
        console.warn(`[auth] Could not refresh Keycloak account ${kcSub}: ${err.message}`);
        const prev = cache.get(kcSub);
        cache.set(kcSub, {
            role: prev?.role ?? null,
            approved: prev?.approved ?? null,
            active: prev?.active ?? null,
            notBefore: prev?.notBefore ?? 0,
            checkedAt: now - REFRESH_MS + RETRY_AFTER_FAILURE_MS,
        });
    }
}

/**
 * Current account state for a Keycloak user.
 *   { active: true,  role, approved, notBefore } — use this role/approval instead of the token's;
 *                                       sessions issued before notBefore (seconds) are ended
 *   { active: false }                  — account deleted or disabled; end the session
 *   { active: null }                   — unknown (Keycloak unreachable, nothing cached); keep token role
 *
 * @param {string} kcSub
 * @param {{ fetchState?: Function }} [deps]
 */
export async function getCurrentAccount(kcSub, { fetchState = getUserAccountState } = {}) {
    const entry = cache.get(kcSub);
    if (!entry || Date.now() - entry.checkedAt >= REFRESH_MS) {
        if (!inflight.has(kcSub)) {
            inflight.set(kcSub, refresh(kcSub, fetchState).finally(() => inflight.delete(kcSub)));
        }
        await inflight.get(kcSub);
    }
    const current = cache.get(kcSub);
    return {
        active: current?.active ?? null,
        role: current?.role ?? null,
        approved: current?.approved ?? null,
        notBefore: current?.notBefore ?? 0,
    };
}

/** Drop cached state (tests; or after a known role change). */
export function forgetAccount(kcSub) {
    if (kcSub === undefined) cache.clear();
    else cache.delete(kcSub);
}
