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
            : '/var/run/docker.sock'
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
    },

    // Keycloak (AUTH_PROVIDER=keycloak)
    keycloak: {
        url:          (process.env.KEYCLOAK_URL    || '').trim().replace(/\/+$/, ''),
        realm:        (process.env.KEYCLOAK_REALM  || 'slicer-web').trim(),
        clientId:     (process.env.KEYCLOAK_CLIENT_ID     || 'slicer-web-backend').trim(),
        clientSecret: (process.env.KEYCLOAK_CLIENT_SECRET || '').trim(),
        // Admin credentials for user management operations (password reset).
        // Production: replace with a service account that has only manage-users permission.
        adminUser:     (process.env.KEYCLOAK_ADMIN_USER     || 'admin').trim(),
        adminPassword: (process.env.KEYCLOAK_ADMIN_PASSWORD || '').trim()
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
        /** Role UUID for OrgAdmin users. Set DIRECTUS_ORG_ADMIN_ROLE_ID in .env. */
        orgAdminRoleId: (process.env.DIRECTUS_ORG_ADMIN_ROLE_ID || '').trim(),
        /**
         * CUTOVER (delete with projectCaseMigrate.js): per-project Migrate → Case button.
         * Default on when Cases are enabled; set ENABLE_PROJECT_CASE_MIGRATE=false to hide.
         */
        projectCaseMigrateEnabled: process.env.ENABLE_PROJECT_CASE_MIGRATE === 'false'
            ? false
            : (process.env.ENABLE_PROJECT_CASE_MIGRATE === 'true'
                || process.env.ENABLE_DIRECTUS_CASES === 'true')
    },

    myFiles: {
        // Set ENABLE_MY_FILES=true to show "My Files" in the sidebar nav (hidden by default).
        enabled: process.env.ENABLE_MY_FILES === 'true'
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
     * Version history / retention.
     * PRUNE_STRATEGY=delete  — delete file from Directus/storage (default)
     * PRUNE_STRATEGY=archive — transition to cheaper storage tier and mark archived
     */
    versioning: {
        pruneStrategy: (process.env.PRUNE_STRATEGY || 'delete').trim().toLowerCase(),
        archiveTier: (process.env.PRUNE_ARCHIVE_TIER || 'glacier_ir').trim().toLowerCase(),
        retentionEnabled: process.env.VERSION_RETENTION_ENABLED !== 'false',
        storageDriverConfigured: Boolean(process.env.STORAGE_DRIVER?.trim())
    },

    /**
     * SlicerWeb channel update service.
     * Requires SLICERWEB_GITHUB_TOKEN (fine-grained PAT, read-only Contents on the deploy repo).
     * ENABLE_SLICERWEB_DEV_MODE=true exposes the latest-channel opt-in in user settings.
     */
    slicerWeb: (() => {
        const repoUrl = (process.env.SLICERWEB_REPO_URL || '').trim();
        // Parse "https://github.com/Owner/Repo.git" or "Owner/Repo"
        const match = repoUrl.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(?:\.git)?$/)
            || repoUrl.match(/^([\w-]+)\/([\w.-]+)$/);
        // GitHub App private key: accept literal PEM or \n-escaped string from env
        const rawKey = (process.env.SLICERWEB_GITHUB_APP_PRIVATE_KEY || '').trim();
        const appPrivateKey = rawKey.replace(/\\n/g, '\n');
        const hasAppCreds = Boolean(
            process.env.SLICERWEB_GITHUB_APP_ID?.trim()
            && process.env.SLICERWEB_GITHUB_APP_INSTALLATION_ID?.trim()
            && appPrivateKey
        );
        const hasPatCreds = Boolean((process.env.SLICERWEB_GITHUB_TOKEN || '').trim());
        const deployKeyPath = (process.env.SLICERWEB_DEPLOY_KEY_PATH || '').trim();
        const hasDeployKey = Boolean(deployKeyPath);
        return {
            // GitHub App credentials (preferred — org-owned, short-lived tokens)
            app: {
                id: (process.env.SLICERWEB_GITHUB_APP_ID || '').trim(),
                installationId: (process.env.SLICERWEB_GITHUB_APP_INSTALLATION_ID || '').trim(),
                privateKey: appPrivateKey
            },
            // PAT fallback for local dev
            githubToken: (process.env.SLICERWEB_GITHUB_TOKEN || '').trim(),
            /** Path to the SSH deploy key (inside container). Set SLICERWEB_DEPLOY_KEY_PATH in .env. */
            deployKeyPath,
            /** True if any GitHub credentials are configured. */
            hasCredentials: hasAppCreds || hasPatCreds || hasDeployKey,
            owner: match?.[1] || '',
            repo: match?.[2] || '',
            stableDir: (process.env.SLICERWEB_STABLE_DIR || '/app/data/slicerweb-stable').trim(),
            latestDir: (process.env.SLICERWEB_LATEST_DIR || '/app/data/slicerweb-latest').trim(),
            /** How often to check the stable channel for updates (default 4 hours). 0 = disabled. */
            stableCheckIntervalMs: (() => {
                const h = Number(process.env.SLICERWEB_STABLE_CHECK_HOURS ?? 4);
                return Number.isFinite(h) && h > 0 ? h * 60 * 60 * 1000 : 0;
            })(),
            /** How often to check the latest channel for updates when dev mode is on (default 5 min). 0 = disabled. */
            latestCheckIntervalMs: (() => {
                const m = Number(process.env.SLICERWEB_LATEST_CHECK_MINUTES ?? 5);
                return Number.isFinite(m) && m > 0 ? m * 60 * 1000 : 0;
            })(),
            /** Allow users to opt into the latest channel from Settings. */
            devModeEnabled: process.env.ENABLE_SLICERWEB_DEV_MODE === 'true',
            /** Shared secret for GitHub push webhook signature verification. */
            webhookSecret: (process.env.SLICERWEB_WEBHOOK_SECRET || '').trim()
        };
    })(),

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
        host: (() => {
            const h = (process.env.SMTP_HOST || '').trim();
            if (!h && process.env.SMTP_ENABLED === 'true') return 'localhost';
            return h;
        })(),
        port: (() => {
            if (process.env.SMTP_PORT) return Math.max(1, Number(process.env.SMTP_PORT) || 587);
            // Default to mailpit port when no host is set (local dev)
            const h = (process.env.SMTP_HOST || '').trim();
            return (!h && process.env.SMTP_ENABLED === 'true') ? 1025 : 587;
        })(),
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
    if (config.auth.provider === 'keycloak' && (!config.keycloak.url || !config.keycloak.clientSecret)) {
        throw new Error('FATAL: AUTH_PROVIDER=keycloak requires KEYCLOAK_URL and KEYCLOAK_CLIENT_SECRET');
    }
} else if (config.auth.devRelaxed) {
    console.warn(
        '⚠️  AUTH_DEV_RELAXED is on — longer idle session and softer login rate limits. '
        + 'Never enable in production.'
    );
}

export default config;
