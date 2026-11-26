import { API_URL } from '../config.js';

const DEFAULT_AUTH = Object.freeze({
    provider: 'local',
    methods: ['password'],
    registrationEnabled: true,
    identityLabel: 'Username or email',
    identityPlaceholder: 'Username or email',
    devRelaxed: false
});

let featuresPromise = null;
let featuresLoaded = false;
let features = Object.freeze({
    inviteEmail: false,
    slicerWebLatest: false,
    slicerWebDefaultChannel: 'stable',
    auth: DEFAULT_AUTH
});

export function getAppFeatures() {
    return features;
}

export function areAppFeaturesLoaded() {
    return featuresLoaded;
}

/** The channel a Settings choice ('default' | 'latest' | 'stable') asks for: Default is the server's. */
export function requestedSlicerWebChannel(choice) {
    return choice === 'latest' || choice === 'stable' ? choice : features.slicerWebDefaultChannel;
}

/**
 * The channel a Settings choice opens. Latest only once the server can serve it (it downloads
 * builds, or one was fetched by hand); stable until then.
 */
export function resolveSlicerWebChannel(choice) {
    const channel = requestedSlicerWebChannel(choice);
    return channel === 'latest' && features.slicerWebLatest === true ? 'latest' : 'stable';
}

/**
 * Load public feature flags once (safe to call repeatedly).
 */
export function loadAppFeatures() {
    if (featuresPromise) return featuresPromise;

    featuresPromise = fetch(`${API_URL}/api/features`, {
        credentials: 'include',
        cache: 'no-store'
    })
        .then(async (res) => {
            if (!res.ok) throw new Error(`features ${res.status}`);
            return res.json();
        })
        .then((data) => {
            const authIn = data?.auth || {};
            const methods = Array.isArray(authIn.methods) && authIn.methods.length
                ? authIn.methods
                : ['password'];
            const auth = {
                provider: authIn.provider || DEFAULT_AUTH.provider,
                methods,
                registrationEnabled: authIn.registrationEnabled !== false,
                identityLabel: authIn.identityLabel || DEFAULT_AUTH.identityLabel,
                identityPlaceholder: authIn.identityPlaceholder || DEFAULT_AUTH.identityPlaceholder,
                devRelaxed: authIn.devRelaxed === true
            };

            features = Object.freeze({
                inviteEmail: data?.inviteEmail === true,
                slicerWebLatest: data?.slicerWebLatest === true,
                slicerWebDefaultChannel: data?.slicerWebDefaultChannel === 'latest' ? 'latest' : 'stable',
                myFiles: data?.myFiles === true,
                auth: Object.freeze(auth)
            });
            featuresLoaded = true;
            return features;
        })
        .catch((err) => {
            console.warn('loadAppFeatures failed; will retry next call:', err?.message || err);
            featuresPromise = null;
            featuresLoaded = false;
            return features;
        });

    return featuresPromise;
}
