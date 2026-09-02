const Database = require("better-sqlite3");

const db = new Database("cheapdata.db");

const columns = db.prepare("PRAGMA table_info(users)").all();

const hasResetTokenHash = columns.some(
    column => column.name === "reset_token_hash"
);

const hasResetTokenExpires = columns.some(
    column => column.name === "reset_token_expires_at"
);

if (!hasResetTokenHash) {
    db.prepare(`
        ALTER TABLE users
        ADD COLUMN reset_token_hash TEXT
    `).run();

    console.log("reset_token_hash column added.");
} else {
    console.log("reset_token_hash column already exists.");
}

if (!hasResetTokenExpires) {
    db.prepare(`
        ALTER TABLE users
        ADD COLUMN reset_token_expires_at INTEGER
    `).run();

    console.log("reset_token_expires_at column added.");
} else {
    console.log("reset_token_expires_at column already exists.");
}

db.close();

console.log("Password reset database setup complete.");