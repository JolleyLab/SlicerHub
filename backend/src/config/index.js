import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Throws an error in production if a required value is missing
 * In development, returns a default value with a warning
 */
function requireInProduction(envVar, defaultValue, errorMessage) {
    const value = process.env[envVar];

    if (!value) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(errorMessage || `${envVar} is required in production`);
        }
        console.warn(`⚠️  WARNING: ${envVar} not set. Using default: "${defaultValue}"`);
        console.warn(`   Set this in production for security!`);
        return defaultValue;
    }

    return value;
}

/**
 * Central configuration for the application
 * All environment-dependent values should be defined here
 */
const config = {
    // Environment
    env: process.env.NODE_ENV || 'development',
    isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
    isProduction: process.env.NODE_ENV === 'production',

    // Server
    server: {
        port: parseInt(process.env.PORT || '8080', 10),
        host: process.env.HOST || '0.0.0.0',
        corsOrigins: process.env.CORS_ORIGINS
            ? process.env.CORS_ORIGINS.split(',')
            : ['http://localhost:8000', 'http://localhost:8082']
    },

    // JWT Authentication
    jwt: {
        secret: requireInProduction(
            'JWT_SECRET',
            'dev-secret-CHANGE-IN-PRODUCTION',
            'JWT_SECRET must be set in production for security'
        ),
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        algorithm: 'HS256'
    },

    // Database
    database: {
        path: process.env.DB_PATH || path.join(__dirname, '../../data/users.db')
    },

    // Docker
    docker: {
        socketPath: os.platform() === 'win32'
            ? '//./pipe/docker_engine'
            : '/var/run/docker.sock',
        network: process.env.DOCKER_NETWORK || 'trame-net',
        defaultImage: process.env.DOCKER_IMAGE || 'slicer-web-trame:local'
    },

    // Trame viewer routing
    trame: {
        viewerPublicBaseUrl: (process.env.TRAME_VIEWER_PUBLIC_BASE_URL || '').trim()
    },

    // Object storage (S3-API compatible; not used until STORAGE_BACKEND=object is implemented)
    objectStorage: {
        endpoint: (process.env.OBJECT_STORAGE_ENDPOINT || '').trim(),
        bucket: (process.env.OBJECT_STORAGE_BUCKET || '').trim(),
        accessKey: (process.env.OBJECT_STORAGE_ACCESS_KEY || '').trim(),
        secretKey: (process.env.OBJECT_STORAGE_SECRET_KEY || '').trim(),
        prefix: (process.env.OBJECT_STORAGE_PREFIX || '').trim(),
        forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
        region: (process.env.OBJECT_STORAGE_REGION || 'us-east-1').trim()
    },

    // Security
    security: {
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
        passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
        // AUTH_DEV_RELAXED uses a longer idle default so re-login (and MFA) is less frequent
        sessionIdleMinutes: parseInt(
            process.env.SESSION_IDLE_MINUTES
                || (process.env.AUTH_DEV_RELAXED === 'true' && process.env.NODE_ENV !== 'production'
                    ? '480'
                    : '30'),
            10
        )
    },

    /**
     * Authentication (BFF).
     * Product session is always this app's JWT + httpOnly cookie.
     * Providers only verify credentials and map to a local user.
     */
    auth: {
        provider: (process.env.AUTH_PROVIDER || 'local').trim().toLowerCase(),
        storeProviderTokens: (() => {
            // Cases require call-as-user tokens. Auto-on when Cases enabled unless explicitly false.
            if (process.env.AUTH_STORE_PROVIDER_TOKENS === 'true') return true;
            if (process.env.AUTH_STORE_PROVIDER_TOKENS === 'false') return false;
            return process.env.ENABLE_DIRECTUS_CASES === 'true';
        })(),
        linkPolicy: (process.env.AUTH_LINK_POLICY || 'strict').trim().toLowerCase(),
        /**
         * Local/dev testing affordances. Never enabled in production
         * (startup throws if AUTH_DEV_RELAXED=true under NODE_ENV=production).
         */
        devRelaxed: process.env.AUTH_DEV_RELAXED === 'true'
            && (process.env.NODE_ENV || 'development') !== 'production',
        /**
         * North star: every product user is also a Directus user (auth_identity_links).
         *   directus-linked — collab/Cases require a Directus link (default when Cases on)
         *   local-only      — legacy; no link required (not the long-term product path)
         */
        identityMode: (process.env.AUTH_IDENTITY_MODE || 'directus-linked').trim().toLowerCase(),
        /**
         * Force Directus link on collab routes.
         * unset → true when ENABLE_DIRECTUS_CASES; false can bypass for local dev only
         */
        requireDirectusLink: process.env.AUTH_REQUIRE_DIRECTUS_LINK === 'true'
            ? true
            : (process.env.AUTH_REQUIRE_DIRECTUS_LINK === 'false' ? false : null),
        webauthn: (() => {
            const isProd = (process.env.NODE_ENV || 'development') === 'production';
            const methodsRaw = (process.env.AUTH_METHODS
                || (isProd ? 'password' : 'password,webauthn')).toLowerCase();
            const methods = new Set(methodsRaw.split(',').map((s) => s.trim()).filter(Boolean));
            const rpID = (process.env.WEBAUTHN_RP_ID || 'localhost').trim();
            const originEnv = (process.env.WEBAUTHN_ORIGIN || '').trim();
            const origins = originEnv
                ? originEnv.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
                : (process.env.CORS_ORIGINS
                    ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/+$/, ''))
                    : ['http://localhost:8000', 'http://localhost:8082']);
            const enabled = methods.has('webauthn') && Boolean(rpID);
            return {
                enabled,
                rpID,
                rpName: (process.env.WEBAUTHN_RP_NAME || 'Slicer Web').trim() || 'Slicer Web',
                origins
            };
        })()
    },

    // Directus headless API (service credentials — Cases / system jobs, not user login)
    directus: {
        url: (process.env.DIRECTUS_URL || '').trim().replace(/\/+$/, ''),
        token: (process.env.DIRECTUS_TOKEN || '').trim(),
        cacheDir: (process.env.DIRECTUS_CACHE_DIR || '').trim(),
        // Off by default — set ENABLE_DIRECTUS_CASES=true to expose Cases UI + /api/directus/*
        casesEnabled: process.env.ENABLE_DIRECTUS_CASES === 'true',
        /** Role UUID for newly provisioned Directus users (app clinician / non-admin). */
        defaultRoleId: (process.env.DIRECTUS_DEFAULT_ROLE_ID || '').trim()
    },

    /**
     * Admin bulk user provision (BFF creates Directus + local link).
     * Modes: temp_password (Pattern A, default) | invite_email (Pattern B, later).
     */
    userProvision: {
        mode: (process.env.USER_PROVISION_MODE || 'temp_password').trim().toLowerCase(),
        /** Shared temp password for batch (empty → generate per user and return once). */
        defaultTemporaryPassword: (process.env.USER_PROVISION_DEFAULT_PASSWORD || '').trim()
    }
};

// Validate configuration on startup
const WEAK_JWT_SECRETS = new Set([
    'dev-secret-CHANGE-IN-PRODUCTION',
    'please-change-this-to-a-secure-random-string-in-production',
    'generate-a-secure-random-string-here'
]);
if (config.isProduction) {
    if (process.env.AUTH_DEV_RELAXED === 'true') {
        throw new Error('FATAL: AUTH_DEV_RELAXED must not be enabled in production');
    }
    if (config.jwt.secret.includes('dev-secret') || WEAK_JWT_SECRETS.has(config.jwt.secret)) {
        throw new Error('FATAL: Set a strong random JWT_SECRET in production (see .env.example)');
    }
    if (!process.env.GPU_CREDENTIALS_KEY?.trim()) {
        throw new Error('FATAL: GPU_CREDENTIALS_KEY must be set in production');
    }
    if (!process.env.TRAME_SYNC_TOKEN?.trim() || process.env.TRAME_SYNC_TOKEN === 'test-sync-token-local') {
        throw new Error('FATAL: Set a strong TRAME_SYNC_TOKEN in production (not the compose default)');
    }
    if (config.auth.storeProviderTokens && !process.env.AUTH_TOKEN_KEY?.trim()) {
        throw new Error(
            'FATAL: AUTH_STORE_PROVIDER_TOKENS=true requires AUTH_TOKEN_KEY in production '
            + '(dedicated key; do not reuse JWT_SECRET as the sole encryptor long term)'
        );
    }
    if (config.auth.provider === 'directus' && !config.directus.url) {
        throw new Error('FATAL: AUTH_PROVIDER=directus requires DIRECTUS_URL');
    }
    if (config.auth.webauthn?.enabled) {
        if (!process.env.WEBAUTHN_RP_ID?.trim() || process.env.WEBAUTHN_RP_ID.trim() === 'localhost') {
            throw new Error(
                'FATAL: WebAuthn is enabled in production — set WEBAUTHN_RP_ID to your public hostname '
                + '(not localhost). Disable via AUTH_METHODS without webauthn if unused.'
            );
        }
        if (!config.auth.webauthn.origins?.length) {
            throw new Error('FATAL: WebAuthn requires WEBAUTHN_ORIGIN or CORS_ORIGINS');
        }
    }
} else if (config.auth.devRelaxed) {
    console.warn(
        '⚠️  AUTH_DEV_RELAXED is on — longer idle session, softer login rate limits, '
        + 'longer device-trust TTL. Never enable in production.'
    );
}

export default config;
