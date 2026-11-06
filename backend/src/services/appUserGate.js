/**
 * Approval gate rollout: SlicerHub requires the `app-user` realm role (or an admin
 * role). Accounts that existed before the gate never needed it, so the first time
 * a backend starts against a realm it grants app-user to every existing account,
 * then records that in a realm attribute so it never runs again. Later accounts
 * without the role (first hospital SSO sign-in, self-registration) wait for a reviewer.
 *
 * Until this one-off grant is confirmed, the gate stays open (authMiddleware), so
 * existing users are never locked out by deploy order or a Keycloak hiccup.
 * docs/redirect-login-and-sessions-design.md (rollout phase 3).
 */

import config from '../config/index.js';
import {
    getRealmAttributes,
    setRealmAttributes,
    listAllUserIds,
    listRealmRoleMemberIds,
    assignRealmRole,
} from './keycloakAdmin.js';

export const GATE_MARKER = 'slicerhub.appUserGrantedAt';
const RETRY_MS = 5 * 60 * 1000;

let ready = false;
let timer = null;

/** True once every pre-gate account is known to hold app-user. */
export function isAppUserGateReady() {
    return ready;
}

/** For tests. */
export function _setGateReadyForTests(value) {
    ready = Boolean(value);
}

/**
 * Grant app-user to every existing account once per realm, then mark the realm.
 * Returns the number of accounts granted (0 when already done).
 */
export async function ensureAppUserGrant(deps = {}) {
    const kc = {
        getRealmAttributes, setRealmAttributes, listAllUserIds, listRealmRoleMemberIds, assignRealmRole,
        ...deps,
    };
    const attributes = await kc.getRealmAttributes();
    if (attributes?.[GATE_MARKER]) {
        ready = true;
        return 0;
    }

    const [allIds, members] = await Promise.all([
        kc.listAllUserIds(),
        kc.listRealmRoleMemberIds('app-user'),
    ]);
    let granted = 0;
    for (const id of allIds) {
        if (members.has(id)) continue;
        await kc.assignRealmRole(id, 'app-user');
        granted++;
    }
    await kc.setRealmAttributes({ [GATE_MARKER]: new Date().toISOString() });
    ready = true;
    console.log(`[gate] Granted app-user to ${granted} existing account(s); approval gate is now on`);
    return granted;
}

/** Run at startup; retry until it succeeds. No-op unless Keycloak is the auth provider. */
export function startAppUserGate() {
    if (config.auth?.provider !== 'keycloak') return;
    const attempt = async () => {
        try {
            await ensureAppUserGrant();
            if (timer) { clearInterval(timer); timer = null; }
        } catch (err) {
            console.warn(`[gate] Could not confirm the app-user grant (gate stays open, retrying): ${err.message}`);
            if (!timer) timer = setInterval(attempt, RETRY_MS);
        }
    };
    attempt();
}
