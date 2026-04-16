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
            ip_address TEXT,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Files table (for user file uploads)
    dbWrapper.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            original_name TEXT NOT NULL,
            stored_name TEXT UNIQUE NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT,
            upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            parent_file_id INTEGER DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_file_id) REFERENCES files(id) ON DELETE SET NULL
        )
    `);

    // Migration: add parent_file_id to existing databases that don't have it
    try {
        dbWrapper.exec(`ALTER TABLE files ADD COLUMN parent_file_id INTEGER DEFAULT NULL`);
    } catch (e) {
        // Column already exists - that's fine
    }

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

    // Create indexes for better performance
    dbWrapper.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_jti);
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
        CREATE INDEX IF NOT EXISTS idx_files_stored_name ON files(stored_name);
        CREATE INDEX IF NOT EXISTS idx_file_shares_file_id ON file_shares(file_id);
        CREATE INDEX IF NOT EXISTS idx_file_shares_user_id ON file_shares(shared_with_user_id);
    `);

    console.log('Database initialized successfully');
}

// Initialize on import
initializeDatabase();

export default dbWrapper;
