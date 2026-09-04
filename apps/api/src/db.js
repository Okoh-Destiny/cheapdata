const Database = require("better-sqlite3");
const { DB_PATH } = require("./config");

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

function createTables() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            purchase_pin TEXT,
            balance REAL NOT NULL DEFAULT 0,
            virtual_account_number TEXT,
            virtual_bank_name TEXT,
            kyc_status TEXT NOT NULL DEFAULT 'pending',
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL,
            reference TEXT,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `).run();
}

function addColumnIfMissing(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = columns.some(existingColumn => existingColumn.name === column);

    if (!exists) {
        db.prepare(`
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        `).run();

        console.log(`Added missing column: ${table}.${column}`);
    }
}

function runMigrations() {
    addColumnIfMissing("users", "purchase_pin", "TEXT");
    addColumnIfMissing("users", "virtual_account_number", "TEXT");
    addColumnIfMissing("users", "virtual_bank_name", "TEXT");
    addColumnIfMissing("users", "kyc_status", "TEXT NOT NULL DEFAULT 'pending'");
    addColumnIfMissing("users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing("users", "reset_token_hash", "TEXT");
    addColumnIfMissing("users", "reset_token_expires_at", "INTEGER");
}

createTables();
runMigrations();

module.exports = {
    db,
    createTables,
    addColumnIfMissing,
    runMigrations
};
