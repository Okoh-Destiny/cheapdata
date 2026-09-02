const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "cheapdata-development-secret-change-this",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

app.use(express.static(path.join(__dirname, "public")));

/* =====================================================
   DATABASE
===================================================== */

const db = new Database(
    path.join(__dirname, "cheapdata.db")
);

db.pragma("journal_mode = WAL");

/* =====================================================
   CREATE TABLES
===================================================== */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL,
        password TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reference TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS data_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        data_size TEXT NOT NULL,
        provider_cost REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL,
        status INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(network, plan_name)
    );
`);

/* =====================================================
   ADD MISSING USER COLUMNS
===================================================== */

function addColumnIfMissing(
    table,
    column,
    definition
) {
    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();

    const exists = columns.some(
        (item) => item.name === column
    );

    if (!exists) {
        db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
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
    "TEXT DEFAULT 'not_verified'"
);

addColumnIfMissing(
    "users",
    "is_admin",
    "INTEGER NOT NULL DEFAULT 0"
);

addColumnIfMissing(
    "users",
    "reset_token_hash",
    "TEXT"
);

addColumnIfMissing(
    "users",
    "reset_token_expires_at",
    "DATETIME"
);

/* =====================================================
   DEFAULT DATA PLANS
===================================================== */

const defaultPlans = [
    ["MTN", "1GB", "1GB", 230, 250],
    ["MTN", "2GB", "2GB", 460, 500],
    ["MTN", "3GB", "3GB", 690, 750],
    ["MTN", "5GB", "5GB", 1150, 1250],
    ["MTN", "10GB", "10GB", 2300, 2500],
    ["MTN", "20GB", "20GB", 4600, 5000],
    ["MTN", "40GB", "40GB", 9200, 10000],

    ["Airtel", "1GB", "1GB", 230, 250],
    ["Airtel", "2GB", "2GB", 460, 500],
    ["Airtel", "3GB", "3GB", 690, 750],
    ["Airtel", "5GB", "5GB", 1150, 1250],

    ["Glo", "1GB", "1GB", 230, 250],
    ["Glo", "2GB", "2GB", 460, 500],
    ["Glo", "3GB", "3GB", 690, 750],
    ["Glo", "5GB", "5GB", 1150, 1250],

    ["9mobile", "1GB", "1GB", 230, 250],
    ["9mobile", "2GB", "2GB", 460, 500],
    ["9mobile", "3GB", "3GB", 690, 750],
    ["9mobile", "5GB", "5GB", 1150, 1250]
];

const insertPlan = db.prepare(`
    INSERT OR IGNORE INTO data_plans
    (
        network,
        plan_name,
        data_size,
        provider_cost,
        selling_price
    )
    VALUES (?, ?, ?, ?, ?)
`);

const seedPlans = db.transaction(() => {
    for (const plan of defaultPlans) {
        insertPlan.run(...plan);
    }
});

seedPlans();

/* =====================================================
   HELPERS
===================================================== */

function generateReference(prefix = "CD") {
    return (
        prefix +
        Date.now() +
        crypto.randomBytes(4).toString("hex").toUpperCase()
    );
}

function isValidNigerianPhone(phone) {
    const value = String(phone || "")
        .replace(/\s+/g, "")
        .replace(/-/g, "");

    return /^(?:\+234|234|0)(?:70|71|80|81|90|91)\d{8}$/.test(
        value
    );
}

function normalizePhone(phone) {
    let value = String(phone || "")
        .replace(/\s+/g, "")
        .replace(/-/g, "");

    if (value.startsWith("+234")) {
        return "0" + value.substring(4);
    }

    if (value.startsWith("234")) {
        return "0" + value.substring(3);
    }

    return value;
}

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please log in first."
        });
    }

    const user = db
        .prepare(
            `
            SELECT id, name, email, phone, balance, is_admin
            FROM users
            WHERE id = ?
            `
        )
        .get(req.session.userId);

    if (!user) {
        req.session.destroy(() => {});

        return res.status(401).json({
            success: false,
            message: "Session expired. Please log in again."
        });
    }

    req.authUser = user;
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please log in first."
        });
    }

    const user = db
        .prepare(
            `
            SELECT id, is_admin
            FROM users
            WHERE id = ?
            `
        )
        .get(req.session.userId);

    if (!user || Number(user.is_admin) !== 1) {
        return res.status(403).json({
            success: false,
            message: "Admin access required."
        });
    }

    req.adminUser = user;
    next();
}

/* =====================================================
   HOME
===================================================== */

app.get("/", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html")
    );
});

/* =====================================================
   SESSION
===================================================== */

app.get("/api/session", (req, res) => {
    if (!req.session.userId) {
        return res.json({
            loggedIn: false
        });
    }

    const user = db
        .prepare(
            `
            SELECT
                id,
                name,
                email,
                phone,
                balance,
                is_admin
            FROM users
            WHERE id = ?
            `
        )
        .get(req.session.userId);

    if (!user) {
        return res.json({
            loggedIn: false
        });
    }

    return res.json({
        loggedIn: true,
        user
    });
});

/* =====================================================
   REGISTER
===================================================== */

app.post("/api/register", async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password
        } = req.body;

        if (
            !name ||
            !email ||
            !phone ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Please fill in all fields."
            });
        }

        if (!isValidNigerianPhone(phone)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid Nigerian phone number."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 6 characters."
            });
        }

        const normalizedEmail =
            String(email).trim().toLowerCase();

        const existingUser = db
            .prepare(
                `
                SELECT id
                FROM users
                WHERE email = ?
                `
            )
            .get(normalizedEmail);

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message:
                    "An account with this email already exists."
            });
        }

        const hashedPassword =
            await bcrypt.hash(password, 12);

        const normalizedPhone =
            normalizePhone(phone);

        const result = db
            .prepare(
                `
                INSERT INTO users
                (
                    name,
                    email,
                    phone,
                    password,
                    balance
                )
                VALUES (?, ?, ?, ?, 0)
                `
            )
            .run(
                String(name).trim(),
                normalizedEmail,
                normalizedPhone,
                hashedPassword
            );

        req.session.userId = result.lastInsertRowid;

        return res.json({
            success: true,
            message:
                "Account created successfully.",
            user: {
                id: result.lastInsertRowid,
                name: String(name).trim(),
                email: normalizedEmail,
                phone: normalizedPhone,
                balance: 0
            }
        });
    } catch (error) {
        console.error(
            "REGISTER ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to create account."
        });
    }
});

/* =====================================================
   LOGIN
===================================================== */

app.post("/api/login", async (req, res) => {
    try {
        const {
            email,
            password
        } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message:
                    "Email and password are required."
            });
        }

        const normalizedEmail =
            String(email).trim().toLowerCase();

        const user = db
            .prepare(
                `
                SELECT *
                FROM users
                WHERE email = ?
                `
            )
            .get(normalizedEmail);

        if (!user) {
            return res.status(401).json({
                success: false,
                message:
                    "Invalid email or password."
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
                message:
                    "Invalid email or password."
            });
        }

        req.session.userId = user.id;

        return res.json({
            success: true,
            message: "Login successful.",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
                is_admin: user.is_admin
            }
        });
    } catch (error) {
        console.error(
            "LOGIN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to log in."
        });
    }
});

/* =====================================================
   LOGOUT
===================================================== */

app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                message: "Unable to log out."
            });
        }

        res.clearCookie("connect.sid");

        return res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

/* =====================================================
   GET USER
===================================================== */

app.get(
    "/api/user/:id",
    requireAuth,
    (req, res) => {
        try {
            const requestedId =
                Number(req.params.id);

            if (
                requestedId !==
                Number(req.authUser.id)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied."
                });
            }

            const user = db
                .prepare(
                    `
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
                    WHERE id = ?
                    `
                )
                .get(requestedId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found."
                });
            }

            return res.json({
                success: true,
                user
            });
        } catch (error) {
            console.error(
                "GET USER ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load user."
            });
        }
    }
);

/* =====================================================
   DEVELOPMENT TEST FUNDING
   Only available when NODE_ENV is not production.
===================================================== */

app.post(
    "/api/test-fund",
    requireAuth,
    (req, res) => {
        if (
            process.env.NODE_ENV ===
            "production"
        ) {
            return res.status(403).json({
                success: false,
                message:
                    "Test funding is disabled in production."
            });
        }

        try {
            const amount =
                Number(req.body.amount);

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid amount."
                });
            }

            const reference =
                generateReference("TEST");

            const transaction =
                db.transaction(() => {
                    db.prepare(
                        `
                        UPDATE users
                        SET balance = balance + ?
                        WHERE id = ?
                        `
                    ).run(
                        amount,
                        req.authUser.id
                    );

                    db.prepare(
                        `
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
                        `
                    ).run(
                        req.authUser.id,
                        "wallet_funding",
                        amount,
                        "successful",
                        reference,
                        "Development test wallet funding"
                    );
                });

            transaction();

            const updatedUser =
                db.prepare(
                    `
                    SELECT balance
                    FROM users
                    WHERE id = ?
                    `
                ).get(req.authUser.id);

            return res.json({
                success: true,
                message:
                    "Test funding successful.",
                balance:
                    updatedUser.balance,
                reference
            });
        } catch (error) {
            console.error(
                "TEST FUND ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to fund wallet."
            });
        }
    }
);

/* =====================================================
   GET DATA PLANS
===================================================== */

app.get(
    "/api/data-plans",
    requireAuth,
    (req, res) => {
        try {
            const plans = db
                .prepare(
                    `
                    SELECT
                        id,
                        network,
                        plan_name,
                        data_size,
                        provider_cost,
                        selling_price
                    FROM data_plans
                    WHERE status = 1
                    ORDER BY
                        CASE network
                            WHEN 'MTN' THEN 1
                            WHEN 'Airtel' THEN 2
                            WHEN 'Glo' THEN 3
                            WHEN '9mobile' THEN 4
                            ELSE 5
                        END,
                        id ASC
                    `
                )
                .all();

            return res.json({
                success: true,
                plans
            });
        } catch (error) {
            console.error(
                "GET DATA PLANS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load data plans."
            });
        }
    }
);

/* =====================================================
   BUY DATA
===================================================== */

app.post(
    "/api/buy-data",
    requireAuth,
    async (req, res) => {
        try {
            const {
                network,
                plan,
                phone,
                purchasePin
            } = req.body;

            /* -----------------------------------------
               BASIC VALIDATION
            ----------------------------------------- */

            if (
                !network ||
                !plan ||
                !phone ||
                !purchasePin
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Network, plan, phone and purchase PIN are required."
                });
            }

            const allowedNetworks = [
                "MTN",
                "Airtel",
                "Glo",
                "9mobile"
            ];

            if (
                !allowedNetworks.includes(
                    String(network)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid network."
                });
            }

            if (!isValidNigerianPhone(phone)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid Nigerian phone number."
                });
            }

            if (
                !/^\d{4}$/.test(
                    String(purchasePin)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits."
                });
            }

            /* -----------------------------------------
               FIND PLAN FROM DATABASE
               NEVER TRUST PRICE FROM BROWSER
            ----------------------------------------- */

            const selectedPlan =
                db.prepare(
                    `
                    SELECT
                        id,
                        network,
                        plan_name,
                        data_size,
                        provider_cost,
                        selling_price
                    FROM data_plans
                    WHERE network = ?
                    AND plan_name = ?
                    AND status = 1
                    LIMIT 1
                    `
                ).get(
                    String(network),
                    String(plan)
                );

            if (!selectedPlan) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Selected data plan is unavailable."
                });
            }

            /* -----------------------------------------
               GET USER
            ----------------------------------------- */

            const user =
                db.prepare(
                    `
                    SELECT
                        id,
                        name,
                        balance,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                    `
                ).get(
                    req.authUser.id
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });
            }

            /* -----------------------------------------
               CHECK PURCHASE PIN
            ----------------------------------------- */

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please set your purchase PIN first."
                });
            }

            const pinMatches =
                await bcrypt.compare(
                    String(purchasePin),
                    user.purchase_pin
                );

            if (!pinMatches) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect purchase PIN."
                });
            }

            /* -----------------------------------------
               SERVER-SIDE PRICE
            ----------------------------------------- */

            const amount =
                Number(
                    selectedPlan.selling_price
                );

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Invalid plan price."
                });
            }

            /* -----------------------------------------
               CHECK BALANCE
            ----------------------------------------- */

            if (
                Number(user.balance) <
                amount
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient wallet balance."
                });
            }

            /* -----------------------------------------
               NORMALIZE PHONE
            ----------------------------------------- */

            const normalizedPhone =
                normalizePhone(phone);

            /* -----------------------------------------
               CREATE REFERENCE
            ----------------------------------------- */

            const reference =
                generateReference("DATA");

            /* -----------------------------------------
               WALLET TRANSACTION
            ----------------------------------------- */

            const purchase =
                db.transaction(() => {
                    const update =
                        db.prepare(
                            `
                            UPDATE users
                            SET balance =
                                balance - ?
                            WHERE id = ?
                            AND balance >= ?
                            `
                        ).run(
                            amount,
                            user.id,
                            amount
                        );

                    if (
                        update.changes !== 1
                    ) {
                        throw new Error(
                            "Insufficient wallet balance."
                        );
                    }

                    db.prepare(
                        `
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
                        `
                    ).run(
                        user.id,
                        "data",
                        amount,
                        "successful",
                        reference,
                        `${selectedPlan.network} ${selectedPlan.plan_name} data purchase for ${normalizedPhone}`
                    );
                });

            purchase();

            /* -----------------------------------------
               GET NEW BALANCE
            ----------------------------------------- */

            const updatedUser =
                db.prepare(
                    `
                    SELECT balance
                    FROM users
                    WHERE id = ?
                    `
                ).get(user.id);

            /*
             * IMPORTANT:
             * This currently records the purchase and
             * deducts the wallet.
             *
             * It does NOT yet send real data to MTN,
             * Airtel, Glo or 9mobile.
             *
             * VTU provider integration comes next.
             */

            return res.json({
                success: true,
                message:
                    "Data purchase recorded successfully.",
                reference,
                network:
                    selectedPlan.network,
                plan:
                    selectedPlan.plan_name,
                phone:
                    normalizedPhone,
                amount,
                balance:
                    updatedUser.balance
            });
        } catch (error) {
            console.error(
                "BUY DATA ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    error.message ===
                    "Insufficient wallet balance."
                        ? error.message
                        : "Unable to process data purchase."
            });
        }
    }
);

/* =====================================================
   BUY AIRTIME
===================================================== */

app.post(
    "/api/buy-airtime",
    requireAuth,
    async (req, res) => {
        try {
            const {
                network,
                phone,
                amount,
                purchasePin
            } = req.body;

            if (
                !network ||
                !phone ||
                !amount ||
                !purchasePin
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Network, phone, amount and purchase PIN are required."
                });
            }

            const allowedNetworks = [
                "MTN",
                "Airtel",
                "Glo",
                "9mobile"
            ];

            if (
                !allowedNetworks.includes(
                    String(network)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid network."
                });
            }

            if (!isValidNigerianPhone(phone)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid Nigerian phone number."
                });
            }

            const airtimeAmount =
                Number(amount);

            if (
                !Number.isFinite(
                    airtimeAmount
                ) ||
                airtimeAmount < 50 ||
                airtimeAmount > 50000
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Airtime amount must be between ₦50 and ₦50,000."
                });
            }

            if (
                !/^\d{4}$/.test(
                    String(purchasePin)
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits."
                });
            }

            const user =
                db.prepare(
                    `
                    SELECT
                        id,
                        balance,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                    `
                ).get(
                    req.authUser.id
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });
            }

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please set your purchase PIN first."
                });
            }

            const pinMatches =
                await bcrypt.compare(
                    String(purchasePin),
                    user.purchase_pin
                );

            if (!pinMatches) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect purchase PIN."
                });
            }

            if (
                Number(user.balance) <
                airtimeAmount
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient wallet balance."
                });
            }

            const normalizedPhone =
                normalizePhone(phone);

            const reference =
                generateReference("AIR");

            const purchase =
                db.transaction(() => {
                    const update =
                        db.prepare(
                            `
                            UPDATE users
                            SET balance =
                                balance - ?
                            WHERE id = ?
                            AND balance >= ?
                            `
                        ).run(
                            airtimeAmount,
                            user.id,
                            airtimeAmount
                        );

                    if (
                        update.changes !== 1
                    ) {
                        throw new Error(
                            "Insufficient wallet balance."
                        );
                    }

                    db.prepare(
                        `
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
                        `
                    ).run(
                        user.id,
                        "airtime",
                        airtimeAmount,
                        "successful",
                        reference,
                        `${network} airtime purchase for ${normalizedPhone}`
                    );
                });

            purchase();

            const updatedUser =
                db.prepare(
                    `
                    SELECT balance
                    FROM users
                    WHERE id = ?
                    `
                ).get(user.id);

            return res.json({
                success: true,
                message:
                    "Airtime purchase recorded successfully.",
                reference,
                network,
                phone: normalizedPhone,
                amount: airtimeAmount,
                balance:
                    updatedUser.balance
            });
        } catch (error) {
            console.error(
                "BUY AIRTIME ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    error.message ===
                    "Insufficient wallet balance."
                        ? error.message
                        : "Unable to process airtime purchase."
            });
        }
    }
);

/* =====================================================
   SET PURCHASE PIN
===================================================== */

app.post(
    "/api/set-purchase-pin",
    requireAuth,
    async (req, res) => {
        try {
            const { pin } = req.body;

            if (!/^\d{4}$/.test(String(pin || ""))) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits."
                });
            }

            const hashedPin =
                await bcrypt.hash(
                    String(pin),
                    12
                );

            db.prepare(
                `
                UPDATE users
                SET purchase_pin = ?
                WHERE id = ?
                `
            ).run(
                hashedPin,
                req.authUser.id
            );

            return res.json({
                success: true,
                message:
                    "Purchase PIN set successfully."
            });
        } catch (error) {
            console.error(
                "SET PIN ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to set purchase PIN."
            });
        }
    }
);

/* =====================================================
   CHANGE PURCHASE PIN
===================================================== */

app.post(
    "/api/change-purchase-pin",
    requireAuth,
    async (req, res) => {
        try {
            const {
                currentPin,
                newPin
            } = req.body;

            if (
                !/^\d{4}$/.test(
                    String(currentPin || "")
                ) ||
                !/^\d{4}$/.test(
                    String(newPin || "")
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Both PINs must be exactly 4 digits."
                });
            }

            const user =
                db.prepare(
                    `
                    SELECT purchase_pin
                    FROM users
                    WHERE id = ?
                    `
                ).get(
                    req.authUser.id
                );

            if (
                !user ||
                !user.purchase_pin
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN has not been set."
                });
            }

            const matches =
                await bcrypt.compare(
                    String(currentPin),
                    user.purchase_pin
                );

            if (!matches) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Current purchase PIN is incorrect."
                });
            }

            const hashedPin =
                await bcrypt.hash(
                    String(newPin),
                    12
                );

            db.prepare(
                `
                UPDATE users
                SET purchase_pin = ?
                WHERE id = ?
                `
            ).run(
                hashedPin,
                req.authUser.id
            );

            return res.json({
                success: true,
                message:
                    "Purchase PIN changed successfully."
            });
        } catch (error) {
            console.error(
                "CHANGE PIN ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to change purchase PIN."
            });
        }
    }
);

/* =====================================================
   VERIFY PURCHASE PIN
===================================================== */

app.post(
    "/api/verify-purchase-pin",
    requireAuth,
    async (req, res) => {
        try {
            const { pin } = req.body;

            if (!/^\d{4}$/.test(String(pin || ""))) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid 4-digit PIN."
                });
            }

            const user =
                db.prepare(
                    `
                    SELECT purchase_pin
                    FROM users
                    WHERE id = ?
                    `
                ).get(
                    req.authUser.id
                );

            if (
                !user ||
                !user.purchase_pin
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN has not been set."
                });
            }

            const matches =
                await bcrypt.compare(
                    String(pin),
                    user.purchase_pin
                );

            return res.json({
                success: true,
                valid: matches,
                message: matches
                    ? "PIN is correct."
                    : "PIN is incorrect."
            });
        } catch (error) {
            console.error(
                "VERIFY PIN ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to verify PIN."
            });
        }
    }
);

/* =====================================================
   TRANSACTION HISTORY
===================================================== */

app.get(
    "/api/transactions",
    requireAuth,
    (req, res) => {
        try {
            const transactions =
                db.prepare(
                    `
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
                    `
                ).all(
                    req.authUser.id
                );

            return res.json({
                success: true,
                transactions
            });
        } catch (error) {
            console.error(
                "TRANSACTION HISTORY ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load transactions."
            });
        }
    }
);

/* =====================================================
   FORGOT PASSWORD
===================================================== */

app.post(
    "/api/forgot-password",
    async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Email address is required."
                });
            }

            const normalizedEmail =
                String(email)
                    .trim()
                    .toLowerCase();

            const user =
                db.prepare(
                    `
                    SELECT id, email
                    FROM users
                    WHERE email = ?
                    `
                ).get(
                    normalizedEmail
                );

            /*
             * We deliberately return the same
             * response whether the account exists
             * or not.
             */

            if (!user) {
                return res.json({
                    success: true,
                    message:
                        "If an account exists with that email, password reset instructions will be provided."
                });
            }

            const resetToken =
                crypto.randomBytes(32).toString(
                    "hex"
                );

            const tokenHash =
                crypto
                    .createHash("sha256")
                    .update(resetToken)
                    .digest("hex");

            const expiresAt =
                new Date(
                    Date.now() +
                        30 * 60 * 1000
                ).toISOString();

            db.prepare(
                `
                UPDATE users
                SET
                    reset_token_hash = ?,
                    reset_token_expires_at = ?
                WHERE id = ?
                `
            ).run(
                tokenHash,
                expiresAt,
                user.id
            );

            /*
             * Email delivery should be connected
             * later through a real email provider.
             *
             * During development the token is logged
             * in the terminal.
             */

            console.log(
                "PASSWORD RESET TOKEN:",
                resetToken
            );

            return res.json({
                success: true,
                message:
                    "If an account exists with that email, password reset instructions will be provided."
            });
        } catch (error) {
            console.error(
                "FORGOT PASSWORD ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to process password reset."
            });
        }
    }
);

/* =====================================================
   RESET PASSWORD
===================================================== */

app.post(
    "/api/reset-password",
    async (req, res) => {
        try {
            const {
                token,
                password
            } = req.body;

            if (!token || !password) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Token and new password are required."
                });
            }

            if (String(password).length < 6) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 6 characters."
                });
            }

            const tokenHash =
                crypto
                    .createHash("sha256")
                    .update(String(token))
                    .digest("hex");

            const user =
                db.prepare(
                    `
                    SELECT id
                    FROM users
                    WHERE reset_token_hash = ?
                    AND reset_token_expires_at > datetime('now')
                    `
                ).get(
                    tokenHash
                );

            if (!user) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset token is invalid or expired."
                });
            }

            const hashedPassword =
                await bcrypt.hash(
                    String(password),
                    12
                );

            db.prepare(
                `
                UPDATE users
                SET
                    password = ?,
                    reset_token_hash = NULL,
                    reset_token_expires_at = NULL
                WHERE id = ?
                `
            ).run(
                hashedPassword,
                user.id
            );

            return res.json({
                success: true,
                message:
                    "Password reset successfully."
            });
        } catch (error) {
            console.error(
                "RESET PASSWORD ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to reset password."
            });
        }
    }
);

/* =====================================================
   PAYSTACK
===================================================== */

async function getPaystackSecretKey() {
    return (
        process.env.PAYSTACK_SECRET_KEY ||
        ""
    );
}

/* =====================================================
   INITIALIZE WALLET FUNDING
===================================================== */

app.post(
    "/api/paystack/initialize",
    requireAuth,
    async (req, res) => {
        try {
            const amount =
                Number(req.body.amount);

            if (
                !Number.isFinite(amount) ||
                amount < 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Minimum wallet funding amount is ₦100."
                });
            }

            const secretKey =
                await getPaystackSecretKey();

            if (!secretKey) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Paystack is not configured yet."
                });
            }

            const reference =
                generateReference("FUND");

            const response =
                await fetch(
                    "https://api.paystack.co/transaction/initialize",
                    {
                        method: "POST",
                        headers: {
                            Authorization:
                                `Bearer ${secretKey}`,
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            email:
                                req.authUser.email,
                            amount:
                                Math.round(
                                    amount * 100
                                ),
                            reference,
                            metadata: {
                                user_id:
                                    req.authUser.id
                            }
                        })
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.status
            ) {
                console.error(
                    "PAYSTACK INITIALIZE ERROR:",
                    data
                );

                return res.status(400).json({
                    success: false,
                    message:
                        data.message ||
                        "Unable to initialize payment."
                });
            }

            db.prepare(
                `
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
                `
            ).run(
                req.authUser.id,
                "wallet_funding",
                amount,
                "pending",
                reference,
                "Paystack wallet funding"
            );

            return res.json({
                success: true,
                authorization_url:
                    data.data.authorization_url,
                access_code:
                    data.data.access_code,
                reference
            });
        } catch (error) {
            console.error(
                "PAYSTACK INITIALIZE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to initialize payment."
            });
        }
    }
);

/* =====================================================
   VERIFY PAYSTACK PAYMENT
===================================================== */

app.get(
    "/api/paystack/verify/:reference",
    requireAuth,
    async (req, res) => {
        try {
            const reference =
                String(
                    req.params.reference
                );

            const transaction =
                db.prepare(
                    `
                    SELECT *
                    FROM transactions
                    WHERE reference = ?
                    AND user_id = ?
                    AND type = 'wallet_funding'
                    `
                ).get(
                    reference,
                    req.authUser.id
                );

            if (!transaction) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Funding transaction not found."
                });
            }

            if (
                transaction.status ===
                "successful"
            ) {
                const user =
                    db.prepare(
                        `
                        SELECT balance
                        FROM users
                        WHERE id = ?
                        `
                    ).get(
                        req.authUser.id
                    );

                return res.json({
                    success: true,
                    message:
                        "Payment already verified.",
                    balance:
                        user.balance,
                    reference
                });
            }

            const secretKey =
                await getPaystackSecretKey();

            if (!secretKey) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Paystack is not configured yet."
                });
            }

            const response =
                await fetch(
                    `https://api.paystack.co/transaction/verify/${encodeURIComponent(
                        reference
                    )}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization:
                                `Bearer ${secretKey}`
                        }
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.status
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        data.message ||
                        "Payment verification failed."
                });
            }

            const payment =
                data.data;

            if (
                payment.status !==
                "success"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment was not successful."
                });
            }

            const paidAmount =
                Number(payment.amount) /
                100;

            if (
                Math.abs(
                    paidAmount -
                        Number(
                            transaction.amount
                        )
                ) > 0.01
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment amount does not match."
                });
            }

            const completeFunding =
                db.transaction(() => {
                    const fresh =
                        db.prepare(
                            `
                            SELECT status
                            FROM transactions
                            WHERE reference = ?
                            `
                        ).get(
                            reference
                        );

                    if (
                        fresh.status ===
                        "successful"
                    ) {
                        return;
                    }

                    db.prepare(
                        `
                        UPDATE users
                        SET balance =
                            balance + ?
                        WHERE id = ?
                        `
                    ).run(
                        paidAmount,
                        req.authUser.id
                    );

                    db.prepare(
                        `
                        UPDATE transactions
                        SET status = 'successful'
                        WHERE reference = ?
                        `
                    ).run(
                        reference
                    );
                });

            completeFunding();

            const user =
                db.prepare(
                    `
                    SELECT balance
                    FROM users
                    WHERE id = ?
                    `
                ).get(
                    req.authUser.id
                );

            return res.json({
                success: true,
                message:
                    "Wallet funded successfully.",
                balance:
                    user.balance,
                reference
            });
        } catch (error) {
            console.error(
                "PAYSTACK VERIFY ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to verify payment."
            });
        }
    }
);

/* =====================================================
   ADMIN - STATS
===================================================== */

app.get(
    "/api/admin/stats",
    requireAdmin,
    (req, res) => {
        try {
            const users =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    `
                ).get();

            const transactions =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM transactions
                    `
                ).get();

            const successful =
                db.prepare(
                    `
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM transactions
                    WHERE status = 'successful'
                    `
                ).get();

            const wallet =
                db.prepare(
                    `
                    SELECT
                        COALESCE(
                            SUM(balance),
                            0
                        ) AS total
                    FROM users
                    `
                ).get();

            return res.json({
                success: true,
                stats: {
                    users:
                        users.count,
                    transactions:
                        transactions.count,
                    successful_transaction_value:
                        successful.total,
                    total_wallet_balance:
                        wallet.total
                }
            });
        } catch (error) {
            console.error(
                "ADMIN STATS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load admin stats."
            });
        }
    }
);

/* =====================================================
   ADMIN - USERS
===================================================== */

app.get(
    "/api/admin/users",
    requireAdmin,
    (req, res) => {
        try {
            const users =
                db.prepare(
                    `
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
                    `
                ).all();

            return res.json({
                success: true,
                users
            });
        } catch (error) {
            console.error(
                "ADMIN USERS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load users."
            });
        }
    }
);

/* =====================================================
   ADMIN - TRANSACTIONS
===================================================== */

app.get(
    "/api/admin/transactions",
    requireAdmin,
    (req, res) => {
        try {
            const transactions =
                db.prepare(
                    `
                    SELECT
                        transactions.id,
                        transactions.user_id,
                        users.name,
                        users.email,
                        transactions.type,
                        transactions.amount,
                        transactions.status,
                        transactions.reference,
                        transactions.description,
                        transactions.created_at
                    FROM transactions
                    LEFT JOIN users
                        ON users.id =
                           transactions.user_id
                    ORDER BY
                        transactions.id DESC
                    `
                ).all();

            return res.json({
                success: true,
                transactions
            });
        } catch (error) {
            console.error(
                "ADMIN TRANSACTIONS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load transactions."
            });
        }
    }
);

/* =====================================================
   ADMIN - DATA PLANS
===================================================== */

app.get(
    "/api/admin/data-plans",
    requireAdmin,
    (req, res) => {
        try {
            const plans =
                db.prepare(
                    `
                    SELECT *
                    FROM data_plans
                    ORDER BY
                        CASE network
                            WHEN 'MTN' THEN 1
                            WHEN 'Airtel' THEN 2
                            WHEN 'Glo' THEN 3
                            WHEN '9mobile' THEN 4
                            ELSE 5
                        END,
                        id ASC
                    `
                ).all();

            return res.json({
                success: true,
                plans
            });
        } catch (error) {
            console.error(
                "ADMIN DATA PLANS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load data plans."
            });
        }
    }
);

/* =====================================================
   ADMIN - UPDATE DATA PLAN PRICE
===================================================== */

app.put(
    "/api/admin/data-plans/:id",
    requireAdmin,
    (req, res) => {
        try {
            const planId =
                Number(req.params.id);

            const {
                selling_price,
                provider_cost,
                status
            } = req.body;

            if (
                !Number.isInteger(
                    planId
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid plan ID."
                });
            }

            const currentPlan =
                db.prepare(
                    `
                    SELECT *
                    FROM data_plans
                    WHERE id = ?
                    `
                ).get(planId);

            if (!currentPlan) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Data plan not found."
                });
            }

            const newSellingPrice =
                selling_price === undefined
                    ? currentPlan.selling_price
                    : Number(selling_price);

            const newProviderCost =
                provider_cost === undefined
                    ? currentPlan.provider_cost
                    : Number(provider_cost);

            const newStatus =
                status === undefined
                    ? currentPlan.status
                    : Number(status);

            if (
                !Number.isFinite(
                    newSellingPrice
                ) ||
                newSellingPrice < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid selling price."
                });
            }

            if (
                !Number.isFinite(
                    newProviderCost
                ) ||
                newProviderCost < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid provider cost."
                });
            }

            db.prepare(
                `
                UPDATE data_plans
                SET
                    provider_cost = ?,
                    selling_price = ?,
                    status = ?
                WHERE id = ?
                `
            ).run(
                newProviderCost,
                newSellingPrice,
                newStatus ? 1 : 0,
                planId
            );

            const updatedPlan =
                db.prepare(
                    `
                    SELECT *
                    FROM data_plans
                    WHERE id = ?
                    `
                ).get(planId);

            return res.json({
                success: true,
                message:
                    "Data plan updated successfully.",
                plan: updatedPlan
            });
        } catch (error) {
            console.error(
                "UPDATE DATA PLAN ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to update data plan."
            });
        }
    }
);

/* =====================================================
   404 API HANDLER
===================================================== */

app.use(
    "/api",
    (req, res) => {
        return res.status(404).json({
            success: false,
            message:
                "API endpoint not found."
        });
    }
);

/* =====================================================
   SERVER ERROR HANDLER
===================================================== */

app.use(
    (error, req, res, next) => {
        console.error(
            "SERVER ERROR:",
            error
        );

        if (res.headersSent) {
            return next(error);
        }

        return res.status(500).json({
            success: false,
            message:
                "An unexpected server error occurred."
        });
    }
);

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {
    console.log("");
    console.log(
        "=========================================="
    );
    console.log(
        "       CHEAPDATA SERVER RUNNING"
    );
    console.log(
        "=========================================="
    );
    console.log(
        `Local: http://localhost:${PORT}`
    );
    console.log(
        "Database: cheapdata.db"
    );
    console.log(
        "=========================================="
    );
    console.log("");
});