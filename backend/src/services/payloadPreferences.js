/**
 * User preferences stored in the Payload `user-preferences` collection.
 * Keyed by Keycloak sub (user ID). Falls back to defaults when Payload
 * is unavailable or the user has no record yet.
 */

import { getPayloadClient } from '../payload/index.js';
import { findByKcSub, upsertByKcSub } from '../payload/upsertByKcSub.js';
import {
    mergeUserPreferences,
    normalizeUserPreferences,
    DEFAULT_USER_PREFERENCES,
} from '../gpu/userPreferences.js';

const COLLECTION = 'user-preferences';

function docToPrefs(doc) {
    if (!doc) return null;
    return normalizeUserPreferences({
        theme: doc.theme,
        useFullSlicer: doc.use_full_slicer,
        useSimplifiedViewer: doc.use_simplified_viewer,
        homeLayout: doc.home_layout,
        slicerWebChannel: doc.slicer_web_channel,
        notifyRegistrationApproval: doc.notify_registration_approval,
        shareNameInGroups: doc.share_name_in_groups,
        activityFilters: doc.activity_filters,
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
        share_name_in_groups: prefs.shareNameInGroups === true,
        activity_filters: prefs.activityFilters ?? null,
    };
}

const findDoc = (kcSub) => findByKcSub(COLLECTION, kcSub);

export async function getPreferencesByKcSub(kcSub) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return { ...DEFAULT_USER_PREFERENCES };

    try {
        const doc = await findDoc(kcSub);
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
        const doc = await findDoc(kcSub);
        return doc !== null;
    } catch {
        return false;
    }
}

export async function updatePreferencesByKcSub(kcSub, patch) {
    const payload = getPayloadClient();
    if (!payload || !kcSub) return { ...DEFAULT_USER_PREFERENCES };

    try {
        const current = docToPrefs(await findDoc(kcSub)) ?? {};
        const merged = mergeUserPreferences(current, patch);
        await upsertByKcSub(COLLECTION, kcSub, prefsToDoc(merged));
        return merged;
    } catch (err) {
        console.error('[payloadPreferences] updatePreferencesByKcSub failed:', err.message, err.stack);
        throw err;
    }
}
