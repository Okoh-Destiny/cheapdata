const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/cheapdata.db");
const db = new Database(dbPath);

const columns = db.prepare("PRAGMA table_info(users)").all();

const hasPurchasePin = columns.some(
    column => column.name === "purchase_pin"
);

if (!hasPurchasePin) {
    db.prepare(`
        ALTER TABLE users
        ADD COLUMN purchase_pin TEXT
    `).run();

    console.log("Purchase PIN column added successfully.");
} else {
    console.log("Purchase PIN column already exists.");
}

db.close();