import { API_URL } from '../config.js';

let featuresPromise = null;
let featuresLoaded = false;
let features = Object.freeze({ directusCases: false });

export function getAppFeatures() {
    return features;
}

export function areAppFeaturesLoaded() {
    return featuresLoaded;
}

export function isDirectusCasesEnabled() {
    return features.directusCases === true;
}

/**
 * Load public feature flags from the BFF (cached for the page session).
 */
export function loadAppFeatures() {
    if (!featuresPromise) {
        featuresPromise = fetch(`${API_URL}/api/features`, { credentials: 'include' })
            .then((response) => (response.ok ? response.json() : {}))
            .then((data) => {
                features = Object.freeze({
                    directusCases: data?.directusCases === true
                });
                featuresLoaded = true;
                return features;
            })
            .catch(() => {
                featuresLoaded = true;
                return features;
            });
    }
    return featuresPromise;
}
