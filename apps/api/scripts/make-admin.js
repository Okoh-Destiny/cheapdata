const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/cheapdata.db");
const db = new Database(dbPath);

// Add admin column if it doesn't exist
const columns = db.prepare("PRAGMA table_info(users)").all();

const hasAdminColumn = columns.some(
    column => column.name === "is_admin"
);

if (!hasAdminColumn) {
    db.prepare(`
        ALTER TABLE users
        ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
    `).run();

    console.log("Admin column added.");
}

// Change this email to the email of the account
// you want to make administrator.
const adminEmail = "test@gmail.com";

const result = db.prepare(`
    UPDATE users
    SET is_admin = 1
    WHERE email = ?
`).run(adminEmail);

if (result.changes > 0) {
    console.log(`${adminEmail} is now an administrator.`);
} else {
    console.log("User not found. Check the email address.");
}

db.close();