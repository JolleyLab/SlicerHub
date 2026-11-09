/**
 * Profile pictures, stored per Keycloak sub (storage.avatarKeyForSub).
 *
 * Lists of people (case owner and collaborators, comment authors, group members) only
 * carry an avatarUrl when the person has uploaded a picture, so the browser doesn't
 * request a picture that isn't there (a 404 in the console for everyone without one).
 * Whether someone has one is cached for a few minutes; their own upload or removal
 * clears it straight away.
 */

import storage from '../storage/index.js';

const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX = 5000;
const known = new Map(); // sub -> { has: boolean, at: ms }

/** Storage key of the person's picture, or null. */
export async function findAvatarKey(sub) {
    if (!sub) return null;
    // The prefix keeps the dot ("avatars/<sub>."), so one sub never matches another.
    const keys = await storage.listByPrefix(storage.avatarKeyForSub(String(sub), ''));
    return keys[0] || null;
}

/** URL for the person's picture, or null when they have none. */
export async function avatarUrlFor(sub) {
    if (!sub) return null;
    const hit = known.get(sub);
    let has;
    if (hit && Date.now() - hit.at < CACHE_MS) {
        has = hit.has;
    } else {
        try {
            has = Boolean(await findAvatarKey(sub));
        } catch {
            return null; // storage hiccup: show initials, don't cache
        }
        if (known.size >= CACHE_MAX) known.delete(known.keys().next().value);
        known.set(sub, { has, at: Date.now() });
    }
    return has ? `/api/users/${encodeURIComponent(sub)}/avatar` : null;
}

/** Call after the person uploads or removes their picture. */
export function forgetAvatar(sub) {
    known.delete(sub);
}
