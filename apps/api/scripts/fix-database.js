const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../../../data/cheapdata.db");
const db = new Database(dbPath);

const columns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map(column => column.name);

if (!columns.includes("virtual_account_number")) {
    db.exec(
        "ALTER TABLE users ADD COLUMN virtual_account_number TEXT"
    );
    console.log("Added virtual_account_number");
}

if (!columns.includes("virtual_bank_name")) {
    db.exec(
        "ALTER TABLE users ADD COLUMN virtual_bank_name TEXT"
    );
    console.log("Added virtual_bank_name");
}

if (!columns.includes("kyc_status")) {
    db.exec(
        "ALTER TABLE users ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'pending'"
    );
    console.log("Added kyc_status");
}

console.log("Database update complete.");

db.close();
