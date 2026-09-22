import User from '../models/User.js';

/**
 * Prefer an explicit open-request flag; otherwise use the account Local viewer pref.
 */
export function resolveUseSimplifiedViewer({ body, userId } = {}) {
    if (body?.useSimplifiedViewer !== undefined) {
        return body.useSimplifiedViewer === true;
    }
    if (userId == null || userId === '') {
        return false;
    }
    const accountPrefs = User.getPreferences(userId);
    return accountPrefs?.useSimplifiedViewer === true;
}
