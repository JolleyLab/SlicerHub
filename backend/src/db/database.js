import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';

// Get database path from config
const dbPath = config.database.path;

// Initialize SQL.js
const SQL = await initSqlJs();

// Load or create database (seed from host bind mount on first named-volume start).
const seedPath = process.env.DB_SEED_PATH || '/app/data-seed/users.db';
if (!fs.existsSync(dbPath) && fs.existsSync(seedPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(seedPath, dbPath);
    console.log(`Seeded database from ${seedPath}`);
}

let db;
if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
} else {
    db = new SQL.Database();
}

// Save database to disk. sql.js exports the full DB on each flush — keep writes
// debounced and off the hot path so Windows Docker bind mounts stay stable.
let saveInProgress = false;
let savePending = false;
let saveTimer = null;
let deferSaves = false;
const SAVE_DEBOUNCE_MS = parseInt(process.env.DB_SAVE_DEBOUNCE_MS || '500', 10);

function writeDatabaseSync() {
    const buffer = Buffer.from(db.export());
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const writeInPlace = () => {
        fs.writeFileSync(dbPath, buffer);
    };

    // Windows Docker Desktop bind mounts reject rename/copy; write in place in dev.
    if (process.env.DB_SAVE_DIRECT === 'true') {
        writeInPlace();
        return;
    }

    const tmpPath = `${dbPath}.tmp`;
    try {
        fs.writeFileSync(tmpPath, buffer);
        if (!fs.existsSync(tmpPath)) {
            writeInPlace();
            return;
        }
        try {
            fs.renameSync(tmpPath, dbPath);
        } catch {
            writeInPlace();
            try {
                fs.unlinkSync(tmpPath);
            } catch (_) {
                // best effort cleanup
            }
        }
    } catch {
        writeInPlace();
    }
}

function saveDatabase() {
    if (saveInProgress) {
        savePending = true;
        return;
    }

    saveInProgress = true;
    try {
        do {
            savePending = false;
            try {
                writeDatabaseSync();
            } catch (err) {
                console.error('Database save failed:', err.message);
            }
        } while (savePending);
    } finally {
        saveInProgress = false;
    }
}

function flushDatabaseSync() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    saveDatabase();
}

function scheduleSave() {
    if (deferSaves) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveDatabase();
    }, Math.max(100, SAVE_DEBOUNCE_MS));
    if (saveTimer.unref) {
        saveTimer.unref();
    }
}

function shutdownDatabase(signal) {
    try {
        flushDatabaseSync();
    } catch (err) {
        console.error(`Database save on ${signal} failed:`, err.message);
    }
    process.exit(0);
}

process.on('exit', () => {
    try {
        flushDatabaseSync();
    } catch (err) {
        console.error('Database save on exit failed:', err.message);
    }
});
process.on('SIGINT', () => shutdownDatabase('SIGINT'));
process.on('SIGTERM', () => shutdownDatabase('SIGTERM'));

// Wrapper to match better-sqlite3 API
const dbWrapper = {
    exec: (sql) => {
        db.run(sql);
        scheduleSave();
    },
    prepare: (sql) => ({
        run: (...params) => {
            db.run(sql, params);
            scheduleSave();

            // Get last insert rowid
            let lastId = null;
            try {
                const result = db.exec('SELECT last_insert_rowid() as id');
                if (result && result[0] && result[0].values && result[0].values[0]) {
                    lastId = result[0].values[0][0];
                }
            } catch (e) {
                console.error('Error getting last insert rowid:', e);
            }

            return {
                lastInsertRowid: lastId,
                changes: 1
            };
        },
        get: (...params) => {
            try {
                const result = db.exec(sql, params);
                if (!result[0]) return null;
                const columns = result[0].columns;
                const values = result[0].values[0];
                if (!values) return null;
                const row = {};
                columns.forEach((col, i) => row[col] = values[i]);
                return row;
            } catch (e) {
                console.error('Database get error:', e);
                return null;
            }
        },
        all: (...params) => {
            try {
                const result = db.exec(sql, params);
                if (!result[0]) return [];
                const columns = result[0].columns;
                return result[0].values.map(values => {
                    const row = {};
                    columns.forEach((col, i) => row[col] = values[i]);
                    return row;
                });
            } catch (e) {
                console.error('Database all error:', e);
                return [];
            }
        }
    }),
    pragma: () => { } // sql.js doesn't need pragma for foreign keys
};

const migrations = [
    {
        id: '001_create_projects_and_collaborators',
        up: `
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL CHECK (length(name) <= 250),
                creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS collaborators (
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role INTEGER NOT NULL CHECK (role IN (0, 1, 2)),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (project_id, user_id),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_collaborators_project_id ON collaborators(project_id);
            CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON collaborators(user_id);
        `
    },
    {
        id: '002_add_project_id_to_files',
        up: `
            ALTER TABLE files
            ADD COLUMN project_id INTEGER
            REFERENCES projects(id)
            ON DELETE SET NULL;

            CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
        `
    },
    {
        id: '003_add_creator_user_id_to_projects',
        up: `
            ALTER TABLE projects
            ADD COLUMN creator_user_id INTEGER
            REFERENCES users(id)
            ON DELETE SET NULL;

            CREATE INDEX IF NOT EXISTS idx_projects_creator_user_id ON projects(creator_user_id);
        `
    },
    {
        id: '004_create_share_links',
        up: `
            CREATE TABLE IF NOT EXISTS share_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                file_id INTEGER NOT NULL,
                created_by_user_id INTEGER NOT NULL,
                expires_at DATETIME,
                read_only INTEGER DEFAULT 1,
                allowed_user_ids TEXT,
                share_mode TEXT DEFAULT 'whole_file',
                view_state_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                revoked_at DATETIME,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
            CREATE INDEX IF NOT EXISTS idx_share_links_file_id ON share_links(file_id);
            CREATE INDEX IF NOT EXISTS idx_share_links_creator ON share_links(created_by_user_id);
        `
    },
    {
        id: '005_add_allowed_user_ids_to_share_links',
        up: `
            ALTER TABLE share_links
            ADD COLUMN allowed_user_ids TEXT;
        `
    },
    {
        id: '006_add_share_mode_and_view_state_to_share_links',
        up: `
            ALTER TABLE share_links
            ADD COLUMN share_mode TEXT DEFAULT 'whole_file';

            ALTER TABLE share_links
            ADD COLUMN view_state_json TEXT;
        `
    },
    {
        id: '007_add_file_last_modified_and_last_viewed',
        up: `
            ALTER TABLE files ADD COLUMN last_modified_at DATETIME;
            ALTER TABLE files ADD COLUMN last_viewed_at DATETIME;
            UPDATE files SET last_modified_at = upload_date WHERE last_modified_at IS NULL;
        `
    },
    {
        id: '008_drop_sessions_ip_address',
        up: `ALTER TABLE sessions DROP COLUMN ip_address;`
    },
    {
        id: '009_project_gpu_settings',
        up: `
            CREATE TABLE IF NOT EXISTS project_gpu_settings (
                project_id INTEGER PRIMARY KEY,
                provider_id TEXT NOT NULL DEFAULT 'local',
                credentials_enc TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_by_user_id INTEGER,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS project_gpu_instances (
                project_id INTEGER PRIMARY KEY,
                provider_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                instance_id TEXT,
                gpu_host TEXT,
                ssh_host TEXT,
                ssh_port INTEGER,
                trame_api_port INTEGER,
                viewer_port INTEGER,
                trame_service_url TEXT,
                viewer_public_base_url TEXT,
                metadata_json TEXT,
                error_message TEXT,
                provision_started_at DATETIME,
                provision_finished_at DATETIME,
                destroyed_at DATETIME,
                created_by_user_id INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
            );
        `
    },
    {
        id: '010_project_gpu_billing_activity',
        up: `
            ALTER TABLE project_gpu_instances
            ADD COLUMN billing_last_activity_at DATETIME;
        `
    },
    {
        id: '011_project_gpu_default_provider',
        up: `
            ALTER TABLE project_gpu_settings
            ADD COLUMN default_provider_id TEXT NOT NULL DEFAULT 'local';
            UPDATE project_gpu_settings
            SET default_provider_id = provider_id;
        `
    },
    {
        id: '012_user_preferences_json',
        up: `
            ALTER TABLE users
            ADD COLUMN preferences_json TEXT;
        `
    },
    {
        id: '013_project_gpu_billing_owner',
        up: `
            ALTER TABLE project_gpu_instances
            ADD COLUMN billing_owner_user_id INTEGER;
            UPDATE project_gpu_instances
            SET billing_owner_user_id = created_by_user_id
            WHERE billing_owner_user_id IS NULL AND created_by_user_id IS NOT NULL;
        `
    },
    {
        id: '014_files_display_title',
        up: `
            ALTER TABLE files
            ADD COLUMN display_title TEXT;
        `
    },
    {
        id: '015_share_links_viewer_kind',
        up: `
            ALTER TABLE share_links
            ADD COLUMN viewer_kind TEXT DEFAULT 'trame';
        `
    },
    {
        id: '016_auth_identity_links',
        up: `
            CREATE TABLE IF NOT EXISTS auth_identity_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                external_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (provider, external_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_auth_identity_links_user_id
                ON auth_identity_links(user_id);

            CREATE TABLE IF NOT EXISTS auth_provider_tokens (
                token_jti TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                provider TEXT NOT NULL,
                access_token TEXT,
                refresh_token TEXT,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_auth_provider_tokens_user_id
                ON auth_provider_tokens(user_id);
        `
    },
    {
        id: '017_auth_audit_events',
        up: `
            CREATE TABLE IF NOT EXISTS auth_audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event TEXT NOT NULL,
                provider TEXT,
                user_id INTEGER,
                identity_hash TEXT,
                ip TEXT,
                user_agent TEXT,
                detail TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_auth_audit_events_created
                ON auth_audit_events(created_at);

            CREATE INDEX IF NOT EXISTS idx_auth_audit_events_user_id
                ON auth_audit_events(user_id);
        `
    },
    {
        id: '018_auth_trusted_devices',
        up: `
            CREATE TABLE IF NOT EXISTS auth_trusted_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                identity_hash TEXT NOT NULL,
                user_id INTEGER,
                device_token_hash TEXT NOT NULL UNIQUE,
                refresh_token_enc TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                last_used_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_identity
                ON auth_trusted_devices(provider, identity_hash);

            CREATE INDEX IF NOT EXISTS idx_auth_trusted_devices_expires
                ON auth_trusted_devices(expires_at);
        `
    },
    {
        id: '019_auth_webauthn',
        up: `
            CREATE TABLE IF NOT EXISTS auth_webauthn_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                credential_id TEXT NOT NULL UNIQUE,
                public_key TEXT NOT NULL,
                counter INTEGER NOT NULL DEFAULT 0,
                transports_json TEXT,
                device_type TEXT,
                backed_up INTEGER DEFAULT 0,
                friendly_name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_auth_webauthn_credentials_user_id
                ON auth_webauthn_credentials(user_id);

            CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
                challenge TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                user_id INTEGER,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_auth_webauthn_challenges_expires
                ON auth_webauthn_challenges(expires_at);
        `
    },
    {
        id: '020_users_must_change_password',
        up: `
            ALTER TABLE users
            ADD COLUMN must_change_password INTEGER DEFAULT 0;
        `
    },
    {
        id: '021_directus_case_timestamps',
        up: `
            CREATE TABLE IF NOT EXISTS directus_case_timestamps (
                case_id TEXT PRIMARY KEY,
                created_at TEXT,
                updated_at TEXT,
                source TEXT,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `
    },
    {
        id: '022_drop_directus_case_timestamps',
        up: `
            DROP TABLE IF EXISTS directus_case_timestamps;
        `
    },
    {
        // Was briefly a user-scoped Directus token table; durable refresh is an
        // httpOnly cookie instead (directusLinkCookie.js). Drop if a prior build created it.
        id: '023_auth_provider_user_tokens',
        up: `
            DROP TABLE IF EXISTS auth_provider_user_tokens;
        `
    },
    {
        id: '024_drop_auth_provider_user_tokens',
        up: `
            DROP TABLE IF EXISTS auth_provider_user_tokens;
        `
    },
    {
        id: '025_case_invites_notifications',
        up: `
            CREATE TABLE IF NOT EXISTS case_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL,
                case_title TEXT,
                invitee_directus_user_id TEXT NOT NULL,
                invitee_email TEXT NOT NULL,
                proposed_role TEXT NOT NULL DEFAULT 'collaborator',
                inviter_directus_user_id TEXT NOT NULL,
                inviter_app_user_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                resolved_by_directus_user_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_case_invites_case_status
                ON case_invites(case_id, status);
            CREATE INDEX IF NOT EXISTS idx_case_invites_invitee
                ON case_invites(invitee_directus_user_id, status);

            CREATE TABLE IF NOT EXISTS user_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                case_id TEXT,
                invite_id INTEGER,
                read_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
                ON user_notifications(user_id, read_at);
        `
    },
    {
        id: '026_case_collaborator_roles',
        up: `
            CREATE TABLE IF NOT EXISTS case_collaborator_roles (
                case_id TEXT NOT NULL,
                directus_user_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'collaborator',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (case_id, directus_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_case_collaborator_roles_case
                ON case_collaborator_roles(case_id);
        `
    },
    {
        id: '027_case_signup_invites',
        up: `
            CREATE TABLE IF NOT EXISTS case_signup_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL,
                case_title TEXT,
                invitee_email TEXT NOT NULL,
                proposed_role TEXT NOT NULL DEFAULT 'collaborator',
                inviter_directus_user_id TEXT NOT NULL,
                inviter_app_user_id INTEGER,
                token_hash TEXT,
                expires_at DATETIME,
                status TEXT NOT NULL DEFAULT 'pending_signup',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                resolved_by_directus_user_id TEXT,
                accepted_directus_user_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_case_signup_invites_case_status
                ON case_signup_invites(case_id, status);
            CREATE INDEX IF NOT EXISTS idx_case_signup_invites_email
                ON case_signup_invites(invitee_email, status);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_case_signup_invites_token
                ON case_signup_invites(token_hash);
        `
    },
    {
        // Passkeys + remember-device removed from the product; drop leftover tables.
        id: '028_drop_passkey_and_trusted_device_tables',
        up: `
            DROP TABLE IF EXISTS auth_webauthn_challenges;
            DROP TABLE IF EXISTS auth_webauthn_credentials;
            DROP TABLE IF EXISTS auth_trusted_devices;
        `
    },
    {
        // CUTOVER (project→case migrate): delete tables + service when window ends.
        id: '029_project_case_migrate_cutover',
        up: `
            CREATE TABLE IF NOT EXISTS project_case_migrations (
                project_id INTEGER PRIMARY KEY,
                case_id TEXT NOT NULL,
                migrated_by_app_user_id INTEGER,
                migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                file_ok INTEGER NOT NULL DEFAULT 0,
                file_failed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'completed',
                notes TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_project_case_migrations_case
                ON project_case_migrations(case_id);

            CREATE TABLE IF NOT EXISTS project_case_pending_collaborators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                case_id TEXT NOT NULL,
                invitee_email TEXT NOT NULL,
                proposed_role TEXT NOT NULL DEFAULT 'collaborator',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                applied_at DATETIME,
                applied_directus_user_id TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_project_case_pending_email_status
                ON project_case_pending_collaborators(invitee_email, status);
            CREATE INDEX IF NOT EXISTS idx_project_case_pending_case
                ON project_case_pending_collaborators(case_id, status);
        `
    }
];

function runMigrations() {
    dbWrapper.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    for (const migration of migrations) {
        const applied = dbWrapper
            .prepare('SELECT id FROM schema_migrations WHERE id = ?')
            .get(migration.id);

        if (!applied) {
            try {
                dbWrapper.exec(migration.up);
                dbWrapper
                    .prepare('INSERT INTO schema_migrations (id) VALUES (?)')
                    .run(migration.id);
                console.log(`Applied migration: ${migration.id}`);
            } catch (error) {
                const message = String(error?.message || '');
                const isDuplicateColumn = message.includes('duplicate column name');
                const isNoSuchColumn = message.includes('no such column');

                if (isDuplicateColumn || isNoSuchColumn) {
                    // If schema was partially updated before this migration was recorded,
                    // mark it as applied so startup can proceed safely.
                    dbWrapper
                        .prepare('INSERT INTO schema_migrations (id) VALUES (?)')
                        .run(migration.id);
                    console.log(`Marked migration as applied after duplicate-column detection: ${migration.id}`);
                } else {
                    throw error;
                }
            }
        }
    }
}

function hasColumn(tableName, columnName) {
    try {
        const result = db.exec(`PRAGMA table_info(${tableName})`);
        const columns = result?.[0]?.values || [];
        return columns.some((row) => row[1] === columnName);
    } catch (_) {
        return false;
    }
}

// Initialize schema
function initializeDatabase() {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active INTEGER DEFAULT 1,
            role TEXT DEFAULT 'user'
        )
    `);

    // Sessions table (for tracking active sessions)
    dbWrapper.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_jti TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Backward-compatible migration for existing databases
    // (older DBs may be missing this column)
    if (!hasColumn('sessions', 'last_activity')) {
        dbWrapper.exec('ALTER TABLE sessions ADD COLUMN last_activity DATETIME');
        dbWrapper.exec('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE last_activity IS NULL');
    }

    // Files table (for user file uploads)
    dbWrapper.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id INTEGER,
            original_name TEXT NOT NULL,
            stored_name TEXT UNIQUE NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT,
            upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        )
    `);

    // File shares table (for sharing files between users)
    dbWrapper.exec(`
        CREATE TABLE IF NOT EXISTS file_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            shared_with_user_id INTEGER,
            permission INTEGER DEFAULT 0,
            shared_by INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Run schema migrations after base tables exist.
    runMigrations();

    // Create indexes for better performance
    dbWrapper.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_jti);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_project_id ON files(project_id);
        CREATE INDEX IF NOT EXISTS idx_files_stored_name ON files(stored_name);
        CREATE INDEX IF NOT EXISTS idx_file_shares_file_id ON file_shares(file_id);
        CREATE INDEX IF NOT EXISTS idx_file_shares_user_id ON file_shares(shared_with_user_id);
    `);

    console.log('Database initialized successfully');
}

// Initialize on import — batch writes during migrations, then one flush.
deferSaves = true;
initializeDatabase();
deferSaves = false;
flushDatabaseSync();

export default dbWrapper;
export { flushDatabaseSync as flushDatabase };

/**
 * Read a single user's password_hash from the on-disk file without replacing
 * the in-memory DB. Used by the password-bridge cutover when a side process
 * (migrate / debug script) updated disk while this server still held a stale hash.
 */
export function readUserPasswordHashFromDisk(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!fs.existsSync(dbPath)) return null;
    let diskDb = null;
    try {
        diskDb = new SQL.Database(fs.readFileSync(dbPath));
        const result = diskDb.exec('SELECT password_hash FROM users WHERE id = ?', [id]);
        if (!result?.[0]?.values?.[0]?.[0]) return null;
        return String(result[0].values[0][0] || '') || null;
    } catch (err) {
        console.warn('readUserPasswordHashFromDisk failed:', err.message || err);
        return null;
    } finally {
        try {
            diskDb?.close();
        } catch {
            /* ignore */
        }
    }
}

/**
 * Replace in-memory DB from disk (disk wins). Call only when you know side
 * processes updated the file and this process must see those rows.
 */
export function reloadDatabaseFromDisk() {
    if (!fs.existsSync(dbPath)) return false;
    try {
        const next = new SQL.Database(fs.readFileSync(dbPath));
        try {
            db.close();
        } catch {
            /* ignore */
        }
        db = next;
        console.info('Database reloaded from disk:', dbPath);
        return true;
    } catch (err) {
        console.error('reloadDatabaseFromDisk failed:', err.message || err);
        return false;
    }
}
