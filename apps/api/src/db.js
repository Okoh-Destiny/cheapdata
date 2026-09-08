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

    /*
     * Data plans are supplied by WiseSub.
     *
     * IMPORTANT:
     * There are NO hard-coded customer data plans here.
     * WiseSub synchronization is responsible for adding/updating plans.
     */
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
    /*
     * User fields.
     */
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
    addColumnIfMissing(
        "users",
        "reset_token_expires_at",
        "INTEGER"
    );

    /*
     * Data-plan fields required by the current application.
     */
    addColumnIfMissing("data_plans", "plan", "TEXT");

    /*
     * Older databases used plan_name.
     * Copy it into the current plan field when necessary.
     */
    if (
        db.prepare("PRAGMA table_info(data_plans)")
            .all()
            .some(column => column.name === "plan_name")
    ) {
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
    addColumnIfMissing(
        "data_plans",
        "last_synced_at",
        "TEXT"
    );

    /*
     * SQLite cannot safely add CURRENT_TIMESTAMP as a
     * non-constant DEFAULT using ALTER TABLE.
     * Therefore add it as a normal TEXT column and
     * populate existing records below.
     */
    addColumnIfMissing(
        "data_plans",
        "updated_at",
        "TEXT"
    );

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

    /*
     * The old demo plans have no WiseSub source.
     * Keep them in the database for recovery/history,
     * but permanently keep them inactive.
     */
    db.prepare(`
        UPDATE data_plans
        SET active = 0
        WHERE source IS NULL
           OR TRIM(source) = ''
    `).run();

    /*
     * WiseSub plans are the active catalog.
     */
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
