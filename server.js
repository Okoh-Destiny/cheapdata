const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = 3000;

// ========================================
// DATABASE
// ========================================

const db = new Database("cheapdata.db");

db.pragma("journal_mode = WAL");

// Users table
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        virtual_account_number TEXT,
        virtual_bank_name TEXT,
        kyc_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// Transactions table
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

// ========================================
// MIDDLEWARE
// ========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// ========================================
// SERVER STATUS
// ========================================

app.get("/api/status", (req, res) => {

    res.json({
        success: true,
        message: "CheapData server is running 🚀"
    });

});

// ========================================
// REGISTER
// ========================================

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
                message: "Please fill in all fields."
            });

        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = phone.trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });

        }

        if (!/^0[789][01][0-9]{8}$/.test(cleanPhone)) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid Nigerian phone number."
            });

        }

        if (password.length < 6) {

            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters."
            });

        }

        const existingUser = db.prepare(`
            SELECT id
            FROM users
            WHERE email = ? OR phone = ?
        `).get(cleanEmail, cleanPhone);

        if (existingUser) {

            return res.status(409).json({
                success: false,
                message: "An account with this email or phone number already exists."
            });

        }

        const hashedPassword =
            await bcrypt.hash(password, 12);

        const result = db.prepare(`
            INSERT INTO users
            (name, email, phone, password)
            VALUES (?, ?, ?, ?)
        `).run(
            cleanName,
            cleanEmail,
            cleanPhone,
            hashedPassword
        );

        res.status(201).json({

            success: true,

            message: "Account created successfully! 🎉",

            userId: result.lastInsertRowid

        });

    } catch (error) {

        console.error(
            "Registration error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while creating your account."

        });

    }

});

// ========================================
// LOGIN
// ========================================

app.post("/api/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;

        if (!email || !password) {

            return res.status(400).json({
                success: false,
                message: "Please enter your email and password."
            });

        }

        const cleanEmail =
            email.trim().toLowerCase();

        const user = db.prepare(`
            SELECT *
            FROM users
            WHERE email = ?
        `).get(cleanEmail);

        if (!user) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }

        const passwordMatch =
            await bcrypt.compare(
                password,
                user.password
            );

        if (!passwordMatch) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }

        res.json({

            success: true,

            message: "Login successful.",

            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
                virtualAccountNumber:
                    user.virtual_account_number,
                virtualBankName:
                    user.virtual_bank_name,
                kycStatus:
                    user.kyc_status
            }

        });

    } catch (error) {

        console.error(
            "Login error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while logging in."

        });

    }

});

// ========================================
// GET USER
// ========================================

app.get("/api/user/:id", (req, res) => {

    try {

        const userId =
            Number(req.params.id);

        if (!Number.isInteger(userId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid user ID."
            });

        }

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
                created_at
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found."
            });

        }

        res.json({
            success: true,
            user: user
        });

    } catch (error) {

        console.error(
            "Get user error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Unable to get user information."
        });

    }

});

// ========================================
// DEVELOPMENT WALLET FUNDING
// ========================================

app.post("/api/test-fund", (req, res) => {

    try {

        const userId =
            Number(req.body.userId);

        const amount =
            Number(req.body.amount);

        if (!Number.isInteger(userId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid user."
            });

        }

        if (
            !Number.isFinite(amount) ||
            amount < 100 ||
            amount > 100000
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Funding amount must be between ₦100 and ₦100,000."
            });

        }

        const user = db.prepare(`
            SELECT id, balance
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found."
            });

        }

        const reference =
            "TEST-" +
            Date.now() +
            "-" +
            Math.floor(
                Math.random() * 10000
            );

        const newBalance =
            Number(user.balance || 0) + amount;

        const transaction = db.transaction(() => {

            db.prepare(`
                UPDATE users
                SET balance = ?
                WHERE id = ?
            `).run(
                newBalance,
                userId
            );

            db.prepare(`
                INSERT INTO transactions
                (
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
                amount,
                "successful",
                reference,
                "Development test wallet funding"
            );

        });

        transaction();

        res.json({

            success: true,

            message:
                "Test wallet funded successfully.",

            balance:
                newBalance,

            reference:
                reference

        });

    } catch (error) {

        console.error(
            "Test funding error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to process test funding."

        });

    }

});

// ========================================
// TRANSACTION HISTORY
// ========================================

app.get(
    "/api/transactions/:userId",
    (req, res) => {

        try {

            const userId =
                Number(req.params.userId);

            if (!Number.isInteger(userId)) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID."
                });

            }

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
            `).all(userId);

            res.json({

                success: true,

                transactions:
                    transactions

            });

        } catch (error) {

            console.error(
                "Transaction history error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to load transactions."

            });

        }

    }
);

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {

    console.log(
        `CheapData is running at http://localhost:${PORT}`
    );

});