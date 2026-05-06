import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';

// Get database path from config
const dbPath = config.database.path;

// Initialize SQL.js
const SQL = await initSqlJs();

// Load or create database
let db;
if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
} else {
    db = new SQL.Database();
}

// Save database to disk
function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, buffer);
}

// Auto-save every 5 seconds
setInterval(saveDatabase, 5000);

// Save on exit
process.on('exit', saveDatabase);
process.on('SIGINT', () => {
    saveDatabase();
    process.exit();
});

// Wrapper to match better-sqlite3 API
const dbWrapper = {
    exec: (sql) => {
        db.run(sql);
        saveDatabase();
    },
    prepare: (sql) => ({
        run: (...params) => {
            db.run(sql, params);
            saveDatabase();

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

                if (isDuplicateColumn) {
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
            ip_address TEXT,
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

// Initialize on import
initializeDatabase();

export default dbWrapper;
