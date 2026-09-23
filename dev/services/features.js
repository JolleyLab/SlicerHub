import { API_URL } from '../config.js';

const DEFAULT_AUTH = Object.freeze({
    provider: 'local',
    methods: ['password'],
    registrationEnabled: true,
    identityLabel: 'Username or email',
    identityPlaceholder: 'Username or email',
    devRelaxed: false,
    // CUTOVER (password-bridge)
    passwordBridge: false
});

let featuresPromise = null;
let featuresLoaded = false;
let features = Object.freeze({
    directusCases: false,
    projectCaseMigrate: false,
    inviteEmail: false,
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

/** CUTOVER (project-case-migrate) */
export function isProjectCaseMigrateEnabled() {
    return features.projectCaseMigrate === true;
}

/** Case signup invite emails via SMTP (copy-link always available). */
export function isInviteEmailEnabled() {
    return features.inviteEmail === true;
}

/** CUTOVER (password-bridge) */
export function isPasswordBridgeEnabled() {
    return features.auth?.passwordBridge === true;
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
                devRelaxed: authIn.devRelaxed === true,
                // CUTOVER (password-bridge)
                passwordBridge: authIn.passwordBridge === true
            };

            features = Object.freeze({
                directusCases: data?.directusCases === true,
                projectCaseMigrate: data?.projectCaseMigrate === true,
                inviteEmail: data?.inviteEmail === true,
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
