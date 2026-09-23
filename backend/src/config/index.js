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
        /** Consecutive bad passwords before account cool-down (default 5). */
        loginMaxFailures: (() => {
            const n = parseInt(process.env.AUTH_LOGIN_MAX_FAILURES || '5', 10);
            return Number.isFinite(n) && n > 0 ? n : 5;
        })(),
        /**
         * Cool-down minutes after the failure threshold (default 30).
         * Soft-lock until email / secondary verification exists.
         */
        loginLockoutMinutes: (() => {
            const n = parseInt(process.env.AUTH_LOGIN_LOCKOUT_MINUTES || '30', 10);
            return Number.isFinite(n) && n > 0 ? n : 30;
        })(),
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
        /**
         * CUTOVER (delete with auth/passwordBridge.js): one-release bridge so migrated
         * users sign in with their old SQLite password once; BFF copies it to Directus.
         * Set AUTH_PASSWORD_BRIDGE=true only for the migration window, then remove.
         */
        passwordBridge: process.env.AUTH_PASSWORD_BRIDGE === 'true'
    },

    // Directus headless API (service credentials — Cases / system jobs, not user login)
    directus: {
        url: (process.env.DIRECTUS_URL || '').trim().replace(/\/+$/, ''),
        token: (process.env.DIRECTUS_TOKEN || '').trim(),
        cacheDir: (process.env.DIRECTUS_CACHE_DIR || '').trim(),
        // Off by default — set ENABLE_DIRECTUS_CASES=true to expose Cases UI + /api/directus/*
        casesEnabled: process.env.ENABLE_DIRECTUS_CASES === 'true',
        /** Role UUID for newly provisioned Directus users (app clinician / non-admin). */
        defaultRoleId: (process.env.DIRECTUS_DEFAULT_ROLE_ID || '').trim(),
        /**
         * CUTOVER (delete with projectCaseMigrate.js): per-project Migrate → Case button.
         * Default on when Cases are enabled; set ENABLE_PROJECT_CASE_MIGRATE=false to hide.
         */
        projectCaseMigrateEnabled: process.env.ENABLE_PROJECT_CASE_MIGRATE === 'false'
            ? false
            : (process.env.ENABLE_PROJECT_CASE_MIGRATE === 'true'
                || process.env.ENABLE_DIRECTUS_CASES === 'true')
    },

    /**
     * Admin bulk user provision (BFF creates Directus + local link).
     * Modes: temp_password (Pattern A, default) | invite_email (Pattern B, later).
     */
    userProvision: {
        mode: (process.env.USER_PROVISION_MODE || 'temp_password').trim().toLowerCase(),
        /** Shared temp password for batch (empty → generate per user and return once). */
        defaultTemporaryPassword: (process.env.USER_PROVISION_DEFAULT_PASSWORD || '').trim()
    },

    /**
     * Public app origin for invite redeem links (browser URL, not API).
     * Dev default matches CORS / nginx front door.
     */
    publicAppUrl: (process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || 'http://localhost:8000')
        .trim()
        .replace(/\/+$/, ''),

    /** Case signup invite link lifetime (days). */
    caseInviteTtlDays: Math.max(1, Math.min(30, Number(process.env.CASE_INVITE_TTL_DAYS || 7) || 7)),

    /**
     * Outbound SMTP for case signup invite emails.
     * Default off until SMTP_ENABLED=true (copy-link after approve still works).
     * Local compose can point at Mailpit; leave SMTP_ENABLED=false until ready to send.
     */
    mail: {
        enabled: (() => {
            if (process.env.SMTP_ENABLED === 'false') return false;
            if (process.env.SMTP_ENABLED === 'true') return true;
            return Boolean((process.env.SMTP_HOST || '').trim());
        })(),
        host: (process.env.SMTP_HOST || '').trim(),
        port: Math.max(1, Number(process.env.SMTP_PORT || 587) || 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: (process.env.SMTP_USER || '').trim(),
        pass: (process.env.SMTP_PASS || '').trim(),
        from: (process.env.SMTP_FROM || 'Case Invites <noreply@localhost>').trim()
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
} else if (config.auth.devRelaxed) {
    console.warn(
        '⚠️  AUTH_DEV_RELAXED is on — longer idle session and softer login rate limits. '
        + 'Never enable in production.'
    );
}

// CUTOVER: remove with auth/passwordBridge.js when SQLite→Directus password migration ends.
if (config.auth.passwordBridge) {
    console.warn(
        '⚠️  AUTH_PASSWORD_BRIDGE is on — SQLite passwords can be copied to Directus on first '
        + 'failed Directus login. Disable and delete auth/passwordBridge.js after the cutover window.'
    );
    if (config.auth.provider !== 'directus') {
        console.warn(
            '⚠️  AUTH_PASSWORD_BRIDGE has no effect unless AUTH_PROVIDER=directus.'
        );
    }
}

export default config;
