/**
 * User preferences stored in the Payload `user-preferences` collection.
 * Keyed by Keycloak sub (user ID). Falls back to defaults when Payload
 * is unavailable or the user has no record yet.
 */

import { getPayloadClient } from '../payload/index.js';
import {
    mergeUserPreferences,
    normalizeUserPreferences,
    DEFAULT_USER_PREFERENCES,
} from '../gpu/userPreferences.js';

function docToPrefs(doc) {
    if (!doc) return null;
    return normalizeUserPreferences({
        theme: doc.theme,
        useFullSlicer: doc.use_full_slicer,
        useSimplifiedViewer: doc.use_simplified_viewer,
        homeLayout: doc.home_layout,
        slicerWebChannel: doc.slicer_web_channel,
        notifyRegistrationApproval: doc.notify_registration_approval,
    });
}

function prefsToDoc(prefs) {
    return {
        theme: prefs.theme,
        use_full_slicer: prefs.useFullSlicer,
        use_simplified_viewer: prefs.useSimplifiedViewer,
        home_layout: prefs.homeLayout ?? null,
        slicer_web_channel: prefs.slicerWebChannel,
        notify_registration_approval: prefs.notifyRegistrationApproval !== false,
    };
}

async function findDoc(payload, kcSub) {
    const result = await payload.find({
        collection: 'user-preferences',
        where: { keycloak_sub: { equals: kcSub } },
        limit: 1,
    });
    return result.docs[0] ?? null;
}

export async function getPreferencesByKcSub(kcSub) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return { ...DEFAULT_USER_PREFERENCES };

    try {
        const doc = await findDoc(payload, kcSub);
        return docToPrefs(doc) ?? { ...DEFAULT_USER_PREFERENCES };
    } catch (err) {
        console.warn('[payloadPreferences] getPreferencesByKcSub failed:', err.message);
        return { ...DEFAULT_USER_PREFERENCES };
    }
}

/** Returns true if the user has at least one saved preferences document in Payload. */
export async function hasCustomPreferences(kcSub) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return false;
    try {
        const doc = await findDoc(payload, kcSub);
        return doc !== null;
    } catch {
        return false;
    }
}

export async function updatePreferencesByKcSub(kcSub, patch) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return { ...DEFAULT_USER_PREFERENCES };

    try {
        const existing = await findDoc(payload, kcSub);
        const current = docToPrefs(existing) ?? {};
        const merged = mergeUserPreferences(current, patch);
        const data = { keycloak_sub: kcSub, ...prefsToDoc(merged) };

        if (existing) {
            await payload.update({ collection: 'user-preferences', id: existing.id, data });
        } else {
            await payload.create({ collection: 'user-preferences', data });
        }

        return merged;
    } catch (err) {
        console.error('[payloadPreferences] updatePreferencesByKcSub failed:', err.message, err.stack);
        throw err;
    }
}
