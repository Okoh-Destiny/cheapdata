const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { DB_PATH } = require("./config");

// Resolve the database path from the CheapData project root.
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

const configuredDbPath =
    DB_PATH || "./apps/api/data/cheapdata.db";

const resolvedDbPath = path.isAbsolute(configuredDbPath)
    ? configuredDbPath
    : path.resolve(PROJECT_ROOT, configuredDbPath);

// Make sure the database directory exists.
const dbDirectory = path.dirname(resolvedDbPath);

if (!fs.existsSync(dbDirectory)) {
    fs.mkdirSync(dbDirectory, { recursive: true });
    console.log(`Created database directory: ${dbDirectory}`);
}

console.log(`Using SQLite database: ${resolvedDbPath}`);

const db = new Database(resolvedDbPath);

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
        CREATE TABLE IF NOT EXISTS data_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            network TEXT NOT NULL,
            plan TEXT NOT NULL,
            provider_cost REAL NOT NULL DEFAULT 0,
            selling_price REAL NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            provider TEXT,
            provider_code TEXT,
            provider_package_code TEXT,
            provider_package_name TEXT,
            data_size TEXT,
            validity TEXT,
            source TEXT,
            last_synced_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(network, plan)
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
    const exists = columns.some(
        existingColumn => existingColumn.name === column
    );

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
    addColumnIfMissing(
        "users",
        "kyc_status",
        "TEXT NOT NULL DEFAULT 'pending'"
    );
    addColumnIfMissing(
        "users",
        "is_admin",
        "INTEGER NOT NULL DEFAULT 0"
    );
    addColumnIfMissing("users", "reset_token_hash", "TEXT");
    addColumnIfMissing("users", "reset_token_expires_at", "INTEGER");

    addColumnIfMissing("data_plans", "plan", "TEXT");

    const columns = db
        .prepare("PRAGMA table_info(data_plans)")
        .all();

    if (columns.some(column => column.name === "plan_name")) {
        db.prepare(`
            UPDATE data_plans
            SET plan = plan_name
            WHERE plan IS NULL
               OR TRIM(plan) = ''
        `).run();
    }

    addColumnIfMissing(
        "data_plans",
        "active",
        "INTEGER NOT NULL DEFAULT 1"
    );
    addColumnIfMissing("data_plans", "provider", "TEXT");
    addColumnIfMissing("data_plans", "provider_code", "TEXT");
    addColumnIfMissing(
        "data_plans",
        "provider_package_code",
        "TEXT"
    );
    addColumnIfMissing(
        "data_plans",
        "provider_package_name",
        "TEXT"
    );
    addColumnIfMissing("data_plans", "data_size", "TEXT");
    addColumnIfMissing("data_plans", "validity", "TEXT");
    addColumnIfMissing("data_plans", "source", "TEXT");
    addColumnIfMissing("data_plans", "last_synced_at", "TEXT");
    addColumnIfMissing("data_plans", "updated_at", "TEXT");

    db.prepare(`
        UPDATE data_plans
        SET updated_at = COALESCE(
            updated_at,
            last_synced_at,
            created_at,
            datetime('now')
        )
        WHERE updated_at IS NULL
           OR TRIM(updated_at) = ''
    `).run();

    db.prepare(`
        UPDATE data_plans
        SET active = 0
        WHERE source IS NULL
           OR TRIM(source) = ''
    `).run();

    db.prepare(`
        UPDATE data_plans
        SET active = 1
        WHERE source IS NOT NULL
          AND TRIM(source) <> ''
    `).run();
}

createTables();
runMigrations();

module.exports = {
    db,
    createTables,
    addColumnIfMissing,
    runMigrations
};
