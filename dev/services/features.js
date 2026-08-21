import { API_URL } from '../config.js';

const DEFAULT_AUTH = Object.freeze({
    provider: 'local',
    methods: ['password'],
    registrationEnabled: true,
    identityLabel: 'Username or email',
    identityPlaceholder: 'Username or email',
    devRelaxed: false,
    rememberDeviceEnabled: false,
    webauthn: Object.freeze({ enabled: false })
});

let featuresPromise = null;
let featuresLoaded = false;
let features = Object.freeze({
    directusCases: false,
    auth: DEFAULT_AUTH
});

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
                const authIn = data?.auth && typeof data.auth === 'object' ? data.auth : {};
                const methods = Array.isArray(authIn.methods) && authIn.methods.length
                    ? authIn.methods
                    : ['password'];
                const auth = {
                    provider: authIn.provider || DEFAULT_AUTH.provider,
                    methods,
                    registrationEnabled: authIn.registrationEnabled !== false,
                    identityLabel: authIn.identityLabel || DEFAULT_AUTH.identityLabel,
                    identityPlaceholder: authIn.identityPlaceholder || DEFAULT_AUTH.identityPlaceholder,
                    devRelaxed: authIn.devRelaxed === true,
                    rememberDeviceEnabled: authIn.rememberDeviceEnabled === true,
                    webauthn: Object.freeze({
                        enabled: authIn.webauthn?.enabled === true,
                        rpId: authIn.webauthn?.rpId || null
                    })
                };

                features = Object.freeze({
                    directusCases: data?.directusCases === true,
                    auth: Object.freeze(auth)
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
