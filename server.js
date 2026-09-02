const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = 3000;

// =========================
// DATABASE
// =========================

const db = new Database("cheapdata.db");

db.pragma("foreign_keys = ON");

// =========================
// CREATE TABLES
// =========================

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

// =========================
// DATABASE MIGRATIONS
// =========================

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

addColumnIfMissing(
    "users",
    "purchase_pin",
    "TEXT"
);

addColumnIfMissing(
    "users",
    "virtual_account_number",
    "TEXT"
);

addColumnIfMissing(
    "users",
    "virtual_bank_name",
    "TEXT"
);

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

// =========================
// MIDDLEWARE
// =========================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

// =========================
// HELPER FUNCTIONS
// =========================

function generateReference(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(
        Math.random() * 10000
    )}`;
}

function isValidNigerianPhone(phone) {
    return /^0[7-9][0-1][0-9]{8}$/.test(phone);
}

function getAdmin(userId) {
    return db.prepare(`
        SELECT
            id,
            name,
            email,
            is_admin
        FROM users
        WHERE id = ?
        AND is_admin = 1
    `).get(userId);
}

// =========================
// API STATUS
// =========================

app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        message: "CheapData API is running"
    });
});

// =========================
// REGISTER
// =========================

app.post("/api/register", async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password
        } = req.body;

        if (!name || !email || !phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Please fill in all fields"
            });
        }

        if (!isValidNigerianPhone(phone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid Nigerian phone number"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters"
            });
        }

        const existingUser = db.prepare(`
            SELECT id
            FROM users
            WHERE email = ?
            OR phone = ?
        `).get(email, phone);

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "Email or phone number already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(
            password,
            10
        );

        const result = db.prepare(`
            INSERT INTO users (
                name,
                email,
                phone,
                password,
                purchase_pin,
                balance,
                kyc_status,
                is_admin
            )
            VALUES (?, ?, ?, ?, NULL, 0, 'pending', 0)
        `).run(
            name,
            email,
            phone,
            hashedPassword
        );

        const user = db.prepare(`
            SELECT
                id,
                name,
                email,
                phone,
                balance,
                virtual_account_number,
                virtual_bank_name,
                kyc_status,
                is_admin,
                purchase_pin,
                created_at
            FROM users
            WHERE id = ?
        `).get(result.lastInsertRowid);

        const hasPurchasePin = Boolean(
            user.purchase_pin
        );

        delete user.purchase_pin;

        res.json({
            success: true,
            message: "Account created successfully",
            user: {
                ...user,
                has_purchase_pin: hasPurchasePin
            }
        });

    } catch (error) {
        console.error(
            "Registration error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
});

// =========================
// LOGIN
// =========================

app.post("/api/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE email = ?
        `).get(email);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        res.json({
            success: true,
            message: "Login successful",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
                virtual_account_number:
                    user.virtual_account_number,
                virtual_bank_name:
                    user.virtual_bank_name,
                kyc_status:
                    user.kyc_status,
                is_admin:
                    user.is_admin,
                has_purchase_pin:
                    Boolean(user.purchase_pin),
                created_at:
                    user.created_at
            }
        });

    } catch (error) {
        console.error(
            "Login error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

// =========================
// GET USER
// =========================

app.get("/api/user/:id", (req, res) => {
    try {
        const user = db.prepare(`
            SELECT
                id,
                name,
                email,
                phone,
                balance,
                virtual_account_number,
                virtual_bank_name,
                kyc_status,
                is_admin,
                purchase_pin,
                created_at
            FROM users
            WHERE id = ?
        `).get(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const hasPurchasePin = Boolean(
            user.purchase_pin
        );

        delete user.purchase_pin;

        res.json({
            success: true,
            user: {
                ...user,
                has_purchase_pin: hasPurchasePin
            }
        });

    } catch (error) {
        console.error(
            "User error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load user"
        });
    }
});

// =========================
// PURCHASE PIN
// =========================

// SET PURCHASE PIN

app.post("/api/purchase-pin/set", async (req, res) => {
    try {
        const {
            userId,
            pin
        } = req.body;

        if (!userId || pin === undefined) {
            return res.status(400).json({
                success: false,
                message: "User ID and PIN are required"
            });
        }

        const pinString = String(pin);

        if (!/^\d{4}$/.test(pinString)) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN must be exactly 4 digits"
            });
        }

        const user = db.prepare(`
            SELECT
                id,
                purchase_pin
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (user.purchase_pin) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN has already been set"
            });
        }

        const hashedPin = await bcrypt.hash(
            pinString,
            10
        );

        db.prepare(`
            UPDATE users
            SET purchase_pin = ?
            WHERE id = ?
        `).run(
            hashedPin,
            userId
        );

        res.json({
            success: true,
            message: "Purchase PIN created successfully"
        });

    } catch (error) {
        console.error(
            "Set Purchase PIN error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not create Purchase PIN"
        });
    }
});

// CHANGE PURCHASE PIN

app.post("/api/purchase-pin/change", async (req, res) => {
    try {
        const {
            userId,
            currentPin,
            newPin
        } = req.body;

        if (
            !userId ||
            currentPin === undefined ||
            newPin === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "All PIN fields are required"
            });
        }

        const currentPinString =
            String(currentPin);

        const newPinString =
            String(newPin);

        if (!/^\d{4}$/.test(currentPinString)) {
            return res.status(400).json({
                success: false,
                message: "Current PIN must be exactly 4 digits"
            });
        }

        if (!/^\d{4}$/.test(newPinString)) {
            return res.status(400).json({
                success: false,
                message: "New PIN must be exactly 4 digits"
            });
        }

        if (currentPinString === newPinString) {
            return res.status(400).json({
                success: false,
                message: "New PIN must be different from current PIN"
            });
        }

        const user = db.prepare(`
            SELECT
                id,
                purchase_pin
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.purchase_pin) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN has not been set"
            });
        }

        const pinCorrect = await bcrypt.compare(
            currentPinString,
            user.purchase_pin
        );

        if (!pinCorrect) {
            return res.status(401).json({
                success: false,
                message: "Current Purchase PIN is incorrect"
            });
        }

        const hashedNewPin = await bcrypt.hash(
            newPinString,
            10
        );

        db.prepare(`
            UPDATE users
            SET purchase_pin = ?
            WHERE id = ?
        `).run(
            hashedNewPin,
            userId
        );

        res.json({
            success: true,
            message: "Purchase PIN changed successfully"
        });

    } catch (error) {
        console.error(
            "Change Purchase PIN error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not change Purchase PIN"
        });
    }
});

// VERIFY PURCHASE PIN

app.post("/api/purchase-pin/verify", async (req, res) => {
    try {
        const {
            userId,
            pin
        } = req.body;

        if (!userId || pin === undefined) {
            return res.status(400).json({
                success: false,
                message: "User ID and PIN are required"
            });
        }

        const pinString = String(pin);

        if (!/^\d{4}$/.test(pinString)) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN must be exactly 4 digits"
            });
        }

        const user = db.prepare(`
            SELECT
                id,
                purchase_pin
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.purchase_pin) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN has not been set"
            });
        }

        const pinCorrect = await bcrypt.compare(
            pinString,
            user.purchase_pin
        );

        if (!pinCorrect) {
            return res.status(401).json({
                success: false,
                message: "Incorrect Purchase PIN"
            });
        }

        res.json({
            success: true,
            message: "Purchase PIN verified"
        });

    } catch (error) {
        console.error(
            "Verify Purchase PIN error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not verify Purchase PIN"
        });
    }
});

// =========================
// TEST FUND
// DEVELOPMENT ONLY
// =========================

app.post("/api/test-fund", (req, res) => {
    try {
        const {
            userId,
            amount
        } = req.body;

        const fundAmount = Number(amount);

        if (
            !userId ||
            !Number.isFinite(fundAmount) ||
            fundAmount <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid funding details"
            });
        }

        const user = db.prepare(`
            SELECT
                id,
                balance
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const reference =
            generateReference("TEST");

        const transaction =
            db.transaction(() => {

                db.prepare(`
                    UPDATE users
                    SET balance = balance + ?
                    WHERE id = ?
                `).run(
                    fundAmount,
                    userId
                );

                db.prepare(`
                    INSERT INTO transactions (
                        user_id,
                        type,
                        amount,
                        status,
                        reference,
                        description
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    userId,
                    "wallet_funding",
                    fundAmount,
                    "successful",
                    reference,
                    "Development test wallet funding"
                );
            });

        transaction();

        const updatedUser = db.prepare(`
            SELECT balance
            FROM users
            WHERE id = ?
        `).get(userId);

        res.json({
            success: true,
            message: "Wallet funded successfully",
            balance: updatedUser.balance,
            reference
        });

    } catch (error) {
        console.error(
            "Test fund error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not fund wallet"
        });
    }
});

// =========================
// PURCHASE DATA
// =========================

app.post("/api/purchase-data", async (req, res) => {
    try {
        const {
            userId,
            network,
            phone,
            plan,
            pin
        } = req.body;

        if (
            !userId ||
            !network ||
            !phone ||
            !plan ||
            pin === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all purchase details including your Purchase PIN"
            });
        }

        const pinString = String(pin);

        if (!/^\d{4}$/.test(pinString)) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN must be exactly 4 digits"
            });
        }

        if (!isValidNigerianPhone(phone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid Nigerian phone number"
            });
        }

        const allowedNetworks = [
            "MTN",
            "Airtel",
            "Glo",
            "9mobile"
        ];

        if (!allowedNetworks.includes(network)) {
            return res.status(400).json({
                success: false,
                message: "Invalid network"
            });
        }

        const dataPlans = {
            "1GB": 250,
            "2GB": 500,
            "5GB": 1250,
            "10GB": 2500,
            "20GB": 5000,
            "40GB": 10000
        };

        if (
            !Object.prototype.hasOwnProperty.call(
                dataPlans,
                plan
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid data plan"
            });
        }

        const price = dataPlans[plan];

        const user = db.prepare(`
            SELECT
                id,
                balance,
                purchase_pin
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.purchase_pin) {
            return res.status(400).json({
                success: false,
                message: "Please create a Purchase PIN before buying data"
            });
        }

        const pinCorrect = await bcrypt.compare(
            pinString,
            user.purchase_pin
        );

        if (!pinCorrect) {
            return res.status(401).json({
                success: false,
                message: "Incorrect Purchase PIN"
            });
        }

        if (user.balance < price) {
            return res.status(400).json({
                success: false,
                message: "Insufficient wallet balance"
            });
        }

        const reference =
            generateReference("DATA");

        const transaction =
            db.transaction(() => {

                db.prepare(`
                    UPDATE users
                    SET balance = balance - ?
                    WHERE id = ?
                    AND balance >= ?
                `).run(
                    price,
                    userId,
                    price
                );

                db.prepare(`
                    INSERT INTO transactions (
                        user_id,
                        type,
                        amount,
                        status,
                        reference,
                        description
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    userId,
                    "debit",
                    price,
                    "successful",
                    reference,
                    `${network} ${plan} data purchase for ${phone}`
                );
            });

        transaction();

        const updatedUser = db.prepare(`
            SELECT balance
            FROM users
            WHERE id = ?
        `).get(userId);

        res.json({
            success: true,
            message: "Data purchase successful",
            network,
            plan,
            phone,
            amount: price,
            balance: updatedUser.balance,
            reference
        });

    } catch (error) {
        console.error(
            "Data purchase error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Data purchase failed"
        });
    }
});

// =========================
// PURCHASE AIRTIME
// =========================

app.post("/api/purchase-airtime", async (req, res) => {
    try {
        const {
            userId,
            network,
            phone,
            amount,
            pin
        } = req.body;

        const airtimeAmount = Number(amount);

        if (
            !userId ||
            !network ||
            !phone ||
            !amount ||
            pin === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all purchase details including your Purchase PIN"
            });
        }

        const pinString = String(pin);

        if (!/^\d{4}$/.test(pinString)) {
            return res.status(400).json({
                success: false,
                message: "Purchase PIN must be exactly 4 digits"
            });
        }

        const allowedNetworks = [
            "MTN",
            "Airtel",
            "Glo",
            "9mobile"
        ];

        if (!allowedNetworks.includes(network)) {
            return res.status(400).json({
                success: false,
                message: "Invalid network"
            });
        }

        if (!isValidNigerianPhone(phone)) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid Nigerian phone number"
            });
        }

        if (
            !Number.isFinite(airtimeAmount) ||
            airtimeAmount < 50 ||
            airtimeAmount > 50000
        ) {
            return res.status(400).json({
                success: false,
                message: "Airtime amount must be between ₦50 and ₦50,000"
            });
        }

        const user = db.prepare(`
            SELECT
                id,
                balance,
                purchase_pin
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        if (!user.purchase_pin) {
            return res.status(400).json({
                success: false,
                message: "Please create a Purchase PIN before buying airtime"
            });
        }

        const pinCorrect = await bcrypt.compare(
            pinString,
            user.purchase_pin
        );

        if (!pinCorrect) {
            return res.status(401).json({
                success: false,
                message: "Incorrect Purchase PIN"
            });
        }

        if (user.balance < airtimeAmount) {
            return res.status(400).json({
                success: false,
                message: "Insufficient wallet balance"
            });
        }

        const reference =
            generateReference("AIRTIME");

        const transaction =
            db.transaction(() => {

                db.prepare(`
                    UPDATE users
                    SET balance = balance - ?
                    WHERE id = ?
                    AND balance >= ?
                `).run(
                    airtimeAmount,
                    userId,
                    airtimeAmount
                );

                db.prepare(`
                    INSERT INTO transactions (
                        user_id,
                        type,
                        amount,
                        status,
                        reference,
                        description
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    userId,
                    "debit",
                    airtimeAmount,
                    "successful",
                    reference,
                    `${network} airtime purchase for ${phone}`
                );
            });

        transaction();

        const updatedUser = db.prepare(`
            SELECT balance
            FROM users
            WHERE id = ?
        `).get(userId);

        res.json({
            success: true,
            message: "Airtime purchase successful",
            network,
            phone,
            amount: airtimeAmount,
            balance: updatedUser.balance,
            reference
        });

    } catch (error) {
        console.error(
            "Airtime purchase error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Airtime purchase failed"
        });
    }
});

// =========================
// USER TRANSACTIONS
// =========================

app.get("/api/transactions/:userId", (req, res) => {
    try {
        const transactions = db.prepare(`
            SELECT
                id,
                type,
                amount,
                status,
                reference,
                description,
                created_at
            FROM transactions
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(req.params.userId);

        res.json({
            success: true,
            transactions
        });

    } catch (error) {
        console.error(
            "Transactions error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load transactions"
        });
    }
});

// =========================
// ADMIN STATS
// =========================

app.get("/api/admin/stats/:userId", (req, res) => {
    try {
        const admin = getAdmin(req.params.userId);

        if (!admin) {
            return res.status(403).json({
                success: false,
                message: "Admin access required"
            });
        }

        const totalUsers = db.prepare(`
            SELECT COUNT(*) AS count
            FROM users
        `).get().count;

        const totalBalance = db.prepare(`
            SELECT COALESCE(SUM(balance), 0) AS total
            FROM users
        `).get().total;

        const totalTransactions = db.prepare(`
            SELECT COUNT(*) AS count
            FROM transactions
        `).get().count;

        const dataPurchases = db.prepare(`
            SELECT COUNT(*) AS count
            FROM transactions
            WHERE type = 'debit'
            AND status = 'successful'
            AND description LIKE '%data purchase%'
        `).get().count;

        const airtimePurchases = db.prepare(`
            SELECT COUNT(*) AS count
            FROM transactions
            WHERE type = 'debit'
            AND status = 'successful'
            AND description LIKE '%airtime purchase%'
        `).get().count;

        const totalRevenue = db.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE type = 'debit'
            AND status = 'successful'
            AND (
                description LIKE '%data purchase%'
                OR description LIKE '%airtime purchase%'
            )
        `).get().total;

        res.json({
            success: true,
            stats: {
                totalUsers,
                totalBalance,
                totalTransactions,
                dataPurchases,
                airtimePurchases,
                totalRevenue
            }
        });

    } catch (error) {
        console.error(
            "Admin stats error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load admin statistics"
        });
    }
});

// =========================
// ADMIN USERS
// =========================

app.get("/api/admin/users/:userId", (req, res) => {
    try {
        const admin = getAdmin(req.params.userId);

        if (!admin) {
            return res.status(403).json({
                success: false,
                message: "Admin access required"
            });
        }

        const users = db.prepare(`
            SELECT
                id,
                name,
                email,
                phone,
                balance,
                virtual_account_number,
                virtual_bank_name,
                kyc_status,
                is_admin,
                created_at
            FROM users
            ORDER BY id DESC
        `).all();

        res.json({
            success: true,
            users
        });

    } catch (error) {
        console.error(
            "Admin users error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load users"
        });
    }
});

// =========================
// ADMIN TRANSACTIONS
// =========================

app.get("/api/admin/transactions/:userId", (req, res) => {
    try {
        const admin = getAdmin(req.params.userId);

        if (!admin) {
            return res.status(403).json({
                success: false,
                message: "Admin access required"
            });
        }

        const transactions = db.prepare(`
            SELECT
                transactions.id,
                users.name AS user_name,
                users.email AS user_email,
                transactions.type,
                transactions.amount,
                transactions.status,
                transactions.reference,
                transactions.description,
                transactions.created_at
            FROM transactions
            INNER JOIN users
                ON users.id = transactions.user_id
            ORDER BY transactions.id DESC
            LIMIT 100
        `).all();

        res.json({
            success: true,
            transactions
        });

    } catch (error) {
        console.error(
            "Admin transactions error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Could not load admin transactions"
        });
    }
});

// =========================
// SERVER
// =========================

// =========================
// FORGOT PASSWORD
// =========================

app.post("/api/forgot-password", (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Please enter your email address."
            });
        }

        const user = db.prepare(`
            SELECT id, email
            FROM users
            WHERE LOWER(email) = ?
        `).get(email);

        // Always return the same message whether the email exists or not.
        // This helps prevent account enumeration.
        if (!user) {
            return res.json({
                success: true,
                message:
                    "If an account exists with that email, password reset instructions will be provided."
            });
        }

        // Generate a secure random reset token
        const resetToken = crypto.randomBytes(32).toString("hex");

        // Store only the SHA-256 hash of the token
        const resetTokenHash = crypto
            .createHash("sha256")
            .update(resetToken)
            .digest("hex");

        // Token expires in 15 minutes
        const expiresAt = Date.now() + (15 * 60 * 1000);

        db.prepare(`
            UPDATE users
            SET reset_token_hash = ?,
                reset_token_expires_at = ?
            WHERE id = ?
        `).run(
            resetTokenHash,
            expiresAt,
            user.id
        );

        // DEVELOPMENT ONLY:
        // This prints the reset link in the terminal.
        const resetUrl =
            `http://localhost:3000/reset-password.html?token=${resetToken}`;

        console.log("");
        console.log("======================================");
        console.log("PASSWORD RESET REQUEST");
        console.log("======================================");
        console.log(`Email: ${user.email}`);
        console.log(`Reset link: ${resetUrl}`);
        console.log("Expires in: 15 minutes");
        console.log("======================================");
        console.log("");

        return res.json({
            success: true,
            message:
                "If an account exists with that email, password reset instructions will be provided."
        });

    } catch (error) {
        console.error("Forgot password error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});
// =========================
// RESET PASSWORD
// =========================

app.post("/api/reset-password", async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Reset token and new password are required."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters."
            });
        }

        // Hash the token received from the reset link
        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        // Find a user with this token
        const user = db.prepare(`
            SELECT id, reset_token_hash, reset_token_expires_at
            FROM users
            WHERE reset_token_hash = ?
        `).get(tokenHash);

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "This password reset link is invalid or has already been used."
            });
        }

        // Check whether the token has expired
        if (
            !user.reset_token_expires_at ||
            Date.now() > user.reset_token_expires_at
        ) {
            return res.status(400).json({
                success: false,
                message: "This password reset link has expired. Please request a new one."
            });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Save the new password and invalidate the reset token
        db.prepare(`
            UPDATE users
            SET password = ?,
                reset_token_hash = NULL,
                reset_token_expires_at = NULL
            WHERE id = ?
        `).run(
            hashedPassword,
            user.id
        );

        return res.json({
            success: true,
            message: "Password reset successfully. You can now log in."
        });

    } catch (error) {
        console.error("Reset password error:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
    // =========================
// FUND WALLET - PAYSTACK
// =========================

app.post("/api/fund-wallet", async (req, res) => {
    try {
        const { userId, amount } = req.body;

        const numericUserId = Number(userId);
        const fundingAmount = Number(amount);

        // Validate user ID
        if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid user account."
            });
        }

        // Validate amount
        if (
            !Number.isInteger(fundingAmount) ||
            fundingAmount < 100 ||
            fundingAmount > 500000
        ) {
            return res.status(400).json({
                success: false,
                message: "Funding amount must be between ₦100 and ₦500,000."
            });
        }

        // Find the user from the database
        const user = db.prepare(`
            SELECT id, email
            FROM users
            WHERE id = ?
        `).get(numericUserId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User account not found."
            });
        }

        // Make sure Paystack secret key exists
        if (!process.env.PAYSTACK_SECRET_KEY) {
            console.error("PAYSTACK_SECRET_KEY is missing.");

            return res.status(500).json({
                success: false,
                message: "Payment system is not configured yet."
            });
        }

        // Generate a unique reference
        const reference =
            `CD-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

        // Paystack expects the amount in kobo
        const amountInKobo = fundingAmount * 100;

        const paystackResponse = await fetch(
            "https://api.paystack.co/transaction/initialize",
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    email: user.email,
                    amount: String(amountInKobo),
                    currency: "NGN",
                    reference: reference,

                    metadata: {
                        user_id: String(user.id),
                        purpose: "wallet_funding"
                    }
                })
            }
        );

        const paystackData = await paystackResponse.json();

        if (
            !paystackResponse.ok ||
            !paystackData.status ||
            !paystackData.data
        ) {
            console.error(
                "Paystack initialization failed:",
                paystackData
            );

            return res.status(400).json({
                success: false,
                message:
                    paystackData.message ||
                    "Unable to initialize payment."
            });
        }

        return res.json({
            success: true,
            message: "Payment initialized successfully.",
            authorization_url:
                paystackData.data.authorization_url,
            access_code:
                paystackData.data.access_code,
            reference:
                paystackData.data.reference
        });

    } catch (error) {

        console.error(
            "Fund wallet error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to initialize payment. Please try again."
        });
    }
});
});
app.listen(PORT, () => {
    console.log(
        `CheapData is running at http://localhost:${PORT}`
    );
});