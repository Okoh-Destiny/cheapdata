// ======================================================
// CHEAPDATA SERVER
// ======================================================

const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const path = require("path");
const axios = require("axios");

require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ======================================================
// DATABASE
// ======================================================

const db = new Database(
    path.join(__dirname, "cheapdata.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(
    path.join(__dirname, "public")
));

// ======================================================
// DATABASE TABLES
// ======================================================

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        password TEXT NOT NULL,
        purchase_pin TEXT,
        balance REAL DEFAULT 0,
        virtual_account_number TEXT,
        virtual_bank_name TEXT,
        kyc_status TEXT DEFAULT 'pending',
        is_admin INTEGER DEFAULT 0,
        reset_token_hash TEXT,
        reset_token_expires_at INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        reference TEXT UNIQUE,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS data_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        data_size TEXT,
        provider_cost REAL DEFAULT 0,
        selling_price REAL DEFAULT 0,
        provider TEXT,
        provider_code TEXT,
        provider_package_code TEXT,
        provider_package_name TEXT,
        validity TEXT,
        status TEXT DEFAULT 'active',
        source TEXT DEFAULT 'wisesub',
        last_synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(network, plan_name)
    );
`);

// ======================================================
// DATABASE MIGRATIONS
// ======================================================

function addColumnIfMissing(
    table,
    column,
    definition
) {
    const columns =
        db.prepare(
            `PRAGMA table_info(${table})`
        ).all();

    const exists =
        columns.some(
            item => item.name === column
        );

    if (!exists) {
        db.exec(
            `ALTER TABLE ${table}
             ADD COLUMN ${column} ${definition}`
        );

        console.log(
            `Added missing column ${table}.${column}`
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
    "TEXT DEFAULT 'pending'"
);

addColumnIfMissing(
    "users",
    "is_admin",
    "INTEGER DEFAULT 0"
);

addColumnIfMissing(
    "users",
    "reset_token_hash",
    "TEXT"
);

addColumnIfMissing(
    "users",
    "reset_token_expires_at",
    "INTEGER"
);

addColumnIfMissing(
    "data_plans",
    "provider_cost",
    "REAL DEFAULT 0"
);

addColumnIfMissing(
    "data_plans",
    "selling_price",
    "REAL DEFAULT 0"
);

addColumnIfMissing(
    "data_plans",
    "provider",
    "TEXT"
);

addColumnIfMissing(
    "data_plans",
    "provider_code",
    "TEXT"
);

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

addColumnIfMissing(
    "data_plans",
    "validity",
    "TEXT"
);

addColumnIfMissing(
    "data_plans",
    "status",
    "TEXT DEFAULT 'active'"
);

addColumnIfMissing(
    "data_plans",
    "source",
    "TEXT DEFAULT 'wisesub'"
);

addColumnIfMissing(
    "data_plans",
    "last_synced_at",
    "DATETIME"
);

// ======================================================
// GENERAL HELPERS
// ======================================================

function generateReference(prefix = "CD") {
    return (
        `${prefix}-${Date.now()}-` +
        crypto.randomBytes(5).toString("hex")
    );
}

function isValidNigerianPhone(phone) {
    const clean = String(phone || "")
        .replace(/\s+/g, "");

    return /^(?:\+234|234|0)7\d{9}$/.test(clean) ||
           /^(?:\+234|234|0)8\d{9}$/.test(clean) ||
           /^(?:\+234|234|0)9\d{9}$/.test(clean);
}

// ======================================================
// PRICING
// ======================================================

function getMarkupPercent() {
    const value = Number(
        process.env.CHEAPDATA_MARKUP_PERCENT || 2
    );

    if (
        !Number.isFinite(value) ||
        value < 0
    ) {
        return 2;
    }

    return value;
}

function calculateSellingPrice(providerCost) {
    const cost = Number(providerCost);

    if (
        !Number.isFinite(cost) ||
        cost <= 0
    ) {
        return 0;
    }

    const markup =
        getMarkupPercent();

    return Math.ceil(
        cost * (1 + markup / 100)
    );
}

// ======================================================
// WISESUB CONFIGURATION
// ======================================================

const WISESUB_BASE_URL =
    process.env.WISESUB_BASE_URL ||
    "https://app.wisesub.com.ng/api/partner/v1";

const WISESUB_API_KEY =
    process.env.WISESUB_API_KEY || "";

const WISESUB_API_SECRET =
    process.env.WISESUB_API_SECRET || "";

const WISESUB_ENVIRONMENT =
    process.env.WISESUB_ENVIRONMENT || "test";

// ======================================================
// WISESUB HELPERS
// ======================================================

function wiseSubConfigured() {
    return Boolean(
        WISESUB_BASE_URL &&
        WISESUB_API_KEY &&
        WISESUB_API_SECRET
    );
}

function getWiseSubHeaders() {
    return {
        Authorization:
            `Bearer ${WISESUB_API_KEY}`,

        "X-API-Secret":
            WISESUB_API_SECRET,

        "X-Environment":
            WISESUB_ENVIRONMENT,

        Accept:
            "application/json",

        "Content-Type":
            "application/json"
    };
}

function wiseSubBaseUrl() {
    return String(
        WISESUB_BASE_URL
    ).replace(/\/+$/, "");
}

async function wiseSubRequest(
    method,
    endpoint,
    body = undefined
) {
    if (!wiseSubConfigured()) {
        throw new Error(
            "WiseSub is not configured. Please check WISESUB_API_KEY, WISESUB_API_SECRET and WISESUB_BASE_URL in .env."
        );
    }

    const url =
        `${wiseSubBaseUrl()}${endpoint}`;

    console.log(
        `WiseSub ${method} ${url}`
    );

    try {
        const response =
            await axios({
                method,
                url,
                headers:
                    getWiseSubHeaders(),
                data:
                    body,
                timeout: 30000,
                validateStatus:
                    () => true
            });

        const payload =
            response.data;

        console.log(
            `WiseSub response status: ${response.status}`
        );

        if (
            response.status < 200 ||
            response.status >= 300
        ) {
            let message =
                `WiseSub request failed with HTTP ${response.status}`;

            if (
                payload &&
                typeof payload === "object"
            ) {
                message =
                    payload.message ||
                    payload.error ||
                    message;
            }

            throw new Error(message);
        }

        return payload;

    } catch (error) {
        if (error.response) {
            const payload =
                error.response.data;

            let message =
                `WiseSub request failed with HTTP ${error.response.status}`;

            if (
                payload &&
                typeof payload === "object"
            ) {
                message =
                    payload.message ||
                    payload.error ||
                    message;
            }

            throw new Error(message);
        }

        if (error.code === "ECONNABORTED") {
            throw new Error(
                "WiseSub request timed out."
            );
        }

        throw new Error(
            error.message ||
            "Could not connect to WiseSub."
        );
    }
}

// ======================================================
// WISESUB RESPONSE EXTRACTION
// ======================================================

function extractPlansFromWiseSubResponse(
    payload
) {
    if (!payload) {
        return [];
    }

    // Direct array
    if (Array.isArray(payload)) {
        return payload;
    }

    // data.packages
    if (
        payload.data &&
        Array.isArray(payload.data.packages)
    ) {
        return payload.data.packages;
    }

    // data array
    if (
        payload.data &&
        Array.isArray(payload.data)
    ) {
        return payload.data;
    }

    // packages
    if (
        Array.isArray(payload.packages)
    ) {
        return payload.packages;
    }

    // data.data.packages
    if (
        payload.data &&
        payload.data.data &&
        Array.isArray(
            payload.data.data.packages
        )
    ) {
        return payload.data.data.packages;
    }

    // data.data array
    if (
        payload.data &&
        payload.data.data &&
        Array.isArray(payload.data.data)
    ) {
        return payload.data.data;
    }

    return [];
}

// ======================================================
// DATA SIZE EXTRACTION
// ======================================================

function extractDataSize(
    packageName
) {
    const text =
        String(packageName || "");

    const match =
        text.match(
            /\b\d+(?:\.\d+)?\s*(?:GB|MB|TB)\b/i
        );

    if (!match) {
        return "";
    }

    return match[0]
        .replace(/\s+/g, "")
        .toUpperCase();
}

// ======================================================
// VALIDITY EXTRACTION
// ======================================================

function extractValidity(
    packageName
) {
    const text =
        String(packageName || "");

    const match =
        text.match(
            /\b\d+(?:\.\d+)?\s*(?:hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years)\b/i
        );

    if (!match) {
        return "";
    }

    return match[0]
        .replace(/\s+/g, " ")
        .trim();
}

// ======================================================
// NORMALIZE WISESUB PLAN
// ======================================================

function normalizeWiseSubPlan(
    raw,
    providerCode,
    providerName
) {
    if (
        !raw ||
        typeof raw !== "object"
    ) {
        return null;
    }

    const packageCode =
        raw.package_code ??
        raw.packageCode ??
        raw.code ??
        raw.package ??
        raw.id;

    const packageName =
        raw.package_name ??
        raw.packageName ??
        raw.name ??
        raw.description ??
        raw.title;

    const providerCost =
        Number(
            raw.price ??
            raw.provider_price ??
            raw.provider_cost ??
            raw.cost ??
            raw.amount
        );

    if (
        packageCode === undefined ||
        packageCode === null ||
        !packageName
    ) {
        return null;
    }

    if (
        !Number.isFinite(providerCost) ||
        providerCost <= 0
    ) {
        return null;
    }

    const networkMap = {
        mtn: "MTN",
        airtel: "Airtel",
        glo: "Glo",
        "9mobile": "9mobile"
    };

    const network =
        networkMap[
            String(providerCode)
                .toLowerCase()
        ] ||
        providerName ||
        providerCode;

    const cleanPackageName =
        String(packageName).trim();

    const dataSize =
        extractDataSize(
            cleanPackageName
        );

    const validity =
        extractValidity(
            cleanPackageName
        );

    const sellingPrice =
        calculateSellingPrice(
            providerCost
        );

    return {
        network,
        plan_name:
            cleanPackageName,

        data_size:
            dataSize,

        provider_cost:
            providerCost,

        selling_price:
            sellingPrice,

        provider:
            providerName,

        provider_code:
            providerCode,

        provider_package_code:
            String(packageCode),

        provider_package_name:
            cleanPackageName,

        validity:
            validity,

        status:
            "active",

        source:
            "wisesub"
    };
}

// ======================================================
// WISESUB PLAN SYNC
// ======================================================

async function syncWiseSubPlans() {
    const providers = [
        {
            code: "mtn",
            name: "MTN Data"
        },
        {
            code: "airtel",
            name: "Airtel Data"
        },
        {
            code: "glo",
            name: "Glo Data"
        },
        {
            code: "9mobile",
            name: "9mobile Data"
        }
    ];

    const result = {
        received: 0,
        added: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        providers: []
    };

    if (!wiseSubConfigured()) {
        throw new Error(
            "WiseSub is not configured. Add your WiseSub credentials to .env first."
        );
    }

    for (
        const provider of providers
    ) {
        try {
            console.log("");
            console.log(
                `Fetching ${provider.name}...`
            );

            const endpoint =
                `/packages?service_type=data&provider_code=${encodeURIComponent(provider.code)}`;

            const payload =
                await wiseSubRequest(
                    "GET",
                    endpoint
                );

            const rawPlans =
                extractPlansFromWiseSubResponse(
                    payload
                );

            console.log(
                `${provider.name}: ${rawPlans.length} package(s) received`
            );

            const providerResult = {
                provider:
                    provider.name,

                provider_code:
                    provider.code,

                received:
                    rawPlans.length,

                added: 0,
                updated: 0,
                skipped: 0,
                failed: 0
            };

            result.received +=
                rawPlans.length;

            for (
                const rawPlan of rawPlans
            ) {
                try {
                    const plan =
                        normalizeWiseSubPlan(
                            rawPlan,
                            provider.code,
                            provider.name
                        );

                    if (!plan) {
                        result.skipped++;
                        providerResult.skipped++;
                        continue;
                    }

                    const existingByCode =
                        db.prepare(`
                            SELECT id
                            FROM data_plans
                            WHERE network = ?
                            AND provider_package_code = ?
                            LIMIT 1
                        `).get(
                            plan.network,
                            plan.provider_package_code
                        );

                    const existingByName =
                        db.prepare(`
                            SELECT id
                            FROM data_plans
                            WHERE network = ?
                            AND plan_name = ?
                            LIMIT 1
                        `).get(
                            plan.network,
                            plan.plan_name
                        );

                    const existing =
                        existingByCode ||
                        existingByName;

                    if (existing) {
                        db.prepare(`
                            UPDATE data_plans
                            SET
                                plan_name = ?,
                                data_size = ?,
                                provider_cost = ?,
                                selling_price = ?,
                                provider = ?,
                                provider_code = ?,
                                provider_package_code = ?,
                                provider_package_name = ?,
                                validity = ?,
                                status = ?,
                                source = ?,
                                last_synced_at = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(
                            plan.plan_name,
                            plan.data_size,
                            plan.provider_cost,
                            plan.selling_price,
                            plan.provider,
                            plan.provider_code,
                            plan.provider_package_code,
                            plan.provider_package_name,
                            plan.validity,
                            plan.status,
                            plan.source,
                            existing.id
                        );

                        result.updated++;
                        providerResult.updated++;

                    } else {
                        db.prepare(`
                            INSERT INTO data_plans (
                                network,
                                plan_name,
                                data_size,
                                provider_cost,
                                selling_price,
                                provider,
                                provider_code,
                                provider_package_code,
                                provider_package_name,
                                validity,
                                status,
                                source,
                                last_synced_at
                            )
                            VALUES (
                                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
                            )
                        `).run(
                            plan.network,
                            plan.plan_name,
                            plan.data_size,
                            plan.provider_cost,
                            plan.selling_price,
                            plan.provider,
                            plan.provider_code,
                            plan.provider_package_code,
                            plan.provider_package_name,
                            plan.validity,
                            plan.status,
                            plan.source
                        );

                        result.added++;
                        providerResult.added++;
                    }

                } catch (planError) {
                    result.failed++;
                    providerResult.failed++;

                    result.errors.push({
                        provider:
                            provider.name,

                        package:
                            rawPlan &&
                            (
                                rawPlan.package_name ||
                                rawPlan.name ||
                                rawPlan.description ||
                                rawPlan.package_code ||
                                rawPlan.code
                            ),

                        error:
                            planError.message
                    });
                }
            }

            result.providers.push(
                providerResult
            );

        } catch (providerError) {
            result.failed++;

            result.errors.push({
                provider:
                    provider.name,

                error:
                    providerError.message
            });

            result.providers.push({
                provider:
                    provider.name,

                provider_code:
                    provider.code,

                received: 0,
                added: 0,
                updated: 0,
                skipped: 0,
                failed: 1,

                error:
                    providerError.message
            });

            console.error(
                `${provider.name} sync failed:`,
                providerError.message
            );
        }
    }

    return result;
}

// ======================================================
// ADMIN HELPER
// ======================================================

function getAdmin(userId) {
    const numericUserId =
        Number(userId);

    if (
        !Number.isInteger(
            numericUserId
        ) ||
        numericUserId <= 0
    ) {
        return null;
    }

    return db.prepare(`
        SELECT
            id,
            name,
            email,
            is_admin
        FROM users
        WHERE id = ?
        AND is_admin = 1
        LIMIT 1
    `).get(numericUserId);
}

function requireAdmin(req, res, next) {
    const userId =
        req.params.userId ||
        req.body.userId ||
        req.query.userId;

    const admin =
        getAdmin(userId);

    if (!admin) {
        return res.status(403).json({
            success: false,
            message:
                "Admin access required"
        });
    }

    req.admin = admin;
    next();
}

// ======================================================
// REGISTER
// ======================================================

app.post(
    "/api/register",
    async (req, res) => {
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
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Name, email and password are required"
                });
            }

            const cleanName =
                String(name).trim();

            const cleanEmail =
                String(email)
                    .trim()
                    .toLowerCase();

            const cleanPhone =
                String(phone || "")
                    .trim();

            if (
                cleanName.length < 2
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid name"
                });
            }

            if (
                String(password).length < 6
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 6 characters"
                });
            }

            const existing =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE LOWER(email) = ?
                    LIMIT 1
                `).get(cleanEmail);

            if (existing) {
                return res.status(409).json({
                    success: false,
                    message:
                        "An account with this email already exists"
                });
            }

            const hashedPassword =
                await bcrypt.hash(
                    String(password),
                    10
                );

            const result =
                db.prepare(`
                    INSERT INTO users (
                        name,
                        email,
                        phone,
                        password,
                        balance,
                        kyc_status,
                        is_admin
                    )
                    VALUES (?, ?, ?, ?, 0, 'pending', 0)
                `).run(
                    cleanName,
                    cleanEmail,
                    cleanPhone,
                    hashedPassword
                );

            const user =
                db.prepare(`
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
                `).get(result.lastInsertRowid);

            res.status(201).json({
                success: true,
                message:
                    "Account created successfully",
                user
            });

        } catch (error) {
            console.error(
                "Registration error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Registration failed"
            });
        }
    }
);

// ======================================================
// LOGIN
// ======================================================

app.post(
    "/api/login",
    async (req, res) => {
        try {
            const {
                email,
                password
            } = req.body;

            if (
                !email ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Email and password are required"
                });
            }

            const cleanEmail =
                String(email)
                    .trim()
                    .toLowerCase();

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE LOWER(email) = ?
                `).get(cleanEmail);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password"
                });
            }

            const passwordMatch =
                await bcrypt.compare(
                    String(password),
                    user.password
                );

            if (!passwordMatch) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password"
                });
            }

            res.json({
                success: true,
                message:
                    "Login successful",

                user: {
                    id:
                        user.id,

                    name:
                        user.name,

                    email:
                        user.email,

                    phone:
                        user.phone,

                    balance:
                        user.balance,

                    virtual_account_number:
                        user.virtual_account_number,

                    virtual_bank_name:
                        user.virtual_bank_name,

                    kyc_status:
                        user.kyc_status,

                    is_admin:
                        user.is_admin,

                    has_purchase_pin:
                        Boolean(
                            user.purchase_pin
                        ),

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
                message:
                    "Login failed"
            });
        }
    }
);

// ======================================================
// GET USER
// ======================================================

app.get(
    "/api/user/:id",
    (req, res) => {
        try {
            const user =
                db.prepare(`
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
                    message:
                        "User not found"
                });
            }

            const hasPurchasePin =
                Boolean(
                    user.purchase_pin
                );

            delete user.purchase_pin;

            res.json({
                success: true,
                user: {
                    ...user,
                    has_purchase_pin:
                        hasPurchasePin
                }
            });

        } catch (error) {
            console.error(
                "User error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load user"
            });
        }
    }
);

// ======================================================
// PURCHASE PIN - SET
// ======================================================

app.post(
    "/api/purchase-pin/set",
    async (req, res) => {
        try {
            const {
                userId,
                pin
            } = req.body;

            if (
                !userId ||
                pin === undefined
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "User ID and PIN are required"
                });
            }

            const pinString =
                String(pin);

            if (
                !/^\d{4}$/.test(
                    pinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits"
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                `).get(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            if (user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN has already been set"
                });
            }

            const hashedPin =
                await bcrypt.hash(
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
                message:
                    "Purchase PIN created successfully"
            });

        } catch (error) {
            console.error(
                "Set Purchase PIN error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not create Purchase PIN"
            });
        }
    }
);

// ======================================================
// PURCHASE PIN - CHANGE
// ======================================================

app.post(
    "/api/purchase-pin/change",
    async (req, res) => {
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
                    message:
                        "All PIN fields are required"
                });
            }

            const currentPinString =
                String(currentPin);

            const newPinString =
                String(newPin);

            if (
                !/^\d{4}$/.test(
                    currentPinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Current PIN must be exactly 4 digits"
                });
            }

            if (
                !/^\d{4}$/.test(
                    newPinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "New PIN must be exactly 4 digits"
                });
            }

            if (
                currentPinString ===
                newPinString
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "New PIN must be different from current PIN"
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                `).get(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN has not been set"
                });
            }

            const correct =
                await bcrypt.compare(
                    currentPinString,
                    user.purchase_pin
                );

            if (!correct) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Current Purchase PIN is incorrect"
                });
            }

            const hashedNewPin =
                await bcrypt.hash(
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
                message:
                    "Purchase PIN changed successfully"
            });

        } catch (error) {
            console.error(
                "Change Purchase PIN error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not change Purchase PIN"
            });
        }
    }
);

// ======================================================
// PURCHASE PIN - VERIFY
// ======================================================

app.post(
    "/api/purchase-pin/verify",
    async (req, res) => {
        try {
            const {
                userId,
                pin
            } = req.body;

            if (
                !userId ||
                pin === undefined
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "User ID and PIN are required"
                });
            }

            const pinString =
                String(pin);

            if (
                !/^\d{4}$/.test(
                    pinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits"
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                `).get(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN has not been set"
                });
            }

            const correct =
                await bcrypt.compare(
                    pinString,
                    user.purchase_pin
                );

            if (!correct) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect Purchase PIN"
                });
            }

            res.json({
                success: true,
                message:
                    "Purchase PIN verified"
            });

        } catch (error) {
            console.error(
                "Verify Purchase PIN error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not verify Purchase PIN"
            });
        }
    }
);

// ======================================================
// DATA PLANS
// ======================================================

app.get(
    "/api/data-plans",
    (req, res) => {
        try {
            const network =
                String(
                    req.query.network || ""
                ).trim();

            let plans;

            if (network) {
                plans =
                    db.prepare(`
                        SELECT
                            id,
                            network,
                            plan_name,
                            data_size,
                            provider_cost,
                            provider_cost AS provider_price,
                            selling_price,
                            selling_price AS price,
                            validity,
                            status,
                            status = 'active' AS is_active
                        FROM data_plans
                        WHERE network = ?
                        AND status = 'active'
                        ORDER BY
                            selling_price ASC,
                            id ASC
                    `).all(network);

            } else {
                plans =
                    db.prepare(`
                        SELECT
                            id,
                            network,
                            plan_name,
                            data_size,
                            provider_cost,
                            provider_cost AS provider_price,
                            selling_price,
                            selling_price AS price,
                            validity,
                            status,
                            status = 'active' AS is_active
                        FROM data_plans
                        WHERE status = 'active'
                        ORDER BY
                            network ASC,
                            selling_price ASC,
                            id ASC
                    `).all();
            }

            res.json({
                success: true,
                plans:
                    Array.isArray(plans)
                        ? plans
                        : []
            });

        } catch (error) {
            console.error(
                "Data plans error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load data plans",
                plans: []
            });
        }
    }
);

app.get(
    "/api/data-plans/:network",
    (req, res) => {
        try {
            const network =
                String(
                    req.params.network || ""
                ).trim();

            const plans =
                db.prepare(`
                    SELECT
                        id,
                        network,
                        plan_name,
                        data_size,
                        provider_cost,
                        provider_cost AS provider_price,
                        selling_price,
                        selling_price AS price,
                        validity,
                        status,
                        status = 'active' AS is_active
                    FROM data_plans
                    WHERE network = ?
                    AND status = 'active'
                    ORDER BY
                        selling_price ASC,
                        id ASC
                `).all(network);

            res.json({
                success: true,
                plans:
                    Array.isArray(plans)
                        ? plans
                        : []
            });

        } catch (error) {
            console.error(
                "Network data plans error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load network data plans",
                plans: []
            });
        }
    }
);

// ======================================================
// ADMIN - WISESUB SYNC
// ======================================================

app.post(
    "/api/admin/sync-wisesub",
    requireAdmin,
    async (req, res) => {
        try {
            console.log("");
            console.log(
                "======================================"
            );
            console.log(
                "STARTING WISESUB PLAN SYNC"
            );
            console.log(
                "======================================"
            );

            const result =
                await syncWiseSubPlans();

            console.log(
                "WISESUB SYNC COMPLETE"
            );

            console.log(result);

            res.json({
                success: true,

                message:
                    "WiseSub synchronization completed",

                result: {
                    received:
                        Number(
                            result.received || 0
                        ),

                    added:
                        Number(
                            result.added || 0
                        ),

                    updated:
                        Number(
                            result.updated || 0
                        ),

                    skipped:
                        Number(
                            result.skipped || 0
                        ),

                    failed:
                        Number(
                            result.failed || 0
                        ),

                    errors:
                        Array.isArray(
                            result.errors
                        )
                            ? result.errors
                            : [],

                    providers:
                        Array.isArray(
                            result.providers
                        )
                            ? result.providers
                            : []
                }
            });

        } catch (error) {
            console.error(
                "WiseSub sync error:",
                error
            );

            res.status(502).json({
                success: false,

                message:
                    error.message ||
                    "Could not synchronize WiseSub plans",

                result: {
                    received: 0,
                    added: 0,
                    updated: 0,
                    skipped: 0,
                    failed: 1,
                    errors: [
                        {
                            error:
                                error.message
                        }
                    ]
                }
            });
        }
    }
);

// ======================================================
// ADMIN - SYNC PLANS COMPATIBILITY ROUTES
// ======================================================

app.post(
    "/api/admin/sync-plans/:userId",
    requireAdmin,
    async (req, res) => {
        try {
            const result =
                await syncWiseSubPlans();

            res.json({
                success: true,
                message:
                    "WiseSub plans synchronized successfully",
                result
            });

        } catch (error) {
            console.error(
                "WiseSub sync error:",
                error
            );

            res.status(502).json({
                success: false,
                message:
                    error.message ||
                    "Could not synchronize WiseSub plans"
            });
        }
    }
);

app.post(
    "/api/admin/sync-plans",
    async (req, res) => {
        try {
            const userId =
                req.body.userId ||
                req.query.userId;

            if (!getAdmin(userId)) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Admin access required"
                });
            }

            const result =
                await syncWiseSubPlans();

            res.json({
                success: true,
                message:
                    "WiseSub plans synchronized successfully",
                result
            });

        } catch (error) {
            console.error(
                "WiseSub sync error:",
                error
            );

            res.status(502).json({
                success: false,
                message:
                    error.message ||
                    "Could not synchronize WiseSub plans"
            });
        }
    }
);

// ======================================================
// ADMIN - VIEW PLANS
// ======================================================

app.get(
    "/api/admin/plans/:userId",
    requireAdmin,
    (req, res) => {
        try {
            const plans =
                db.prepare(`
                    SELECT
                        id,
                        network,
                        plan_name,
                        data_size,
                        provider_cost,
                        selling_price,
                        provider,
                        provider_code,
                        provider_package_code,
                        provider_package_name,
                        validity,
                        status,
                        source,
                        last_synced_at,
                        created_at
                    FROM data_plans
                    ORDER BY
                        network ASC,
                        selling_price ASC,
                        id ASC
                `).all();

            res.json({
                success: true,
                plans:
                    Array.isArray(plans)
                        ? plans
                        : []
            });

        } catch (error) {
            console.error(
                "Admin plans error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load admin plans",
                plans: []
            });
        }
    }
);

// ======================================================
// TEST FUND
// DEVELOPMENT ONLY
// ======================================================

app.post(
    "/api/test-fund",
    (req, res) => {
        try {
            const {
                userId,
                amount
            } = req.body;

            const numericUserId =
                Number(userId);

            const fundAmount =
                Number(amount);

            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0 ||
                !Number.isFinite(
                    fundAmount
                ) ||
                fundAmount <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid funding details"
                });
            }

            const user =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            const reference =
                generateReference("TEST");

            const transaction =
                db.transaction(() => {

                    db.prepare(`
                        UPDATE users
                        SET balance =
                            balance + ?
                        WHERE id = ?
                    `).run(
                        fundAmount,
                        numericUserId
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
                        numericUserId,
                        "wallet_funding",
                        fundAmount,
                        "successful",
                        reference,
                        "Development test wallet funding"
                    );
                });

            transaction();

            const updatedUser =
                db.prepare(`
                    SELECT balance
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            res.json({
                success: true,
                message:
                    "Wallet funded successfully",
                balance:
                    updatedUser.balance,
                reference
            });

        } catch (error) {
            console.error(
                "Test fund error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not fund wallet"
            });
        }
    }
);

// ======================================================
// PURCHASE DATA
// ======================================================

app.post(
    "/api/purchase-data",
    async (req, res) => {
        try {
            const {
                userId,
                network,
                phone,
                planId,
                plan,
                pin
            } = req.body;

            const numericUserId =
                Number(userId);

            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0 ||
                !network ||
                !phone ||
                pin === undefined
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please provide all purchase details including your Purchase PIN"
                });
            }

            const pinString =
                String(pin);

            if (
                !/^\d{4}$/.test(
                    pinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits"
                });
            }

            const cleanPhone =
                String(phone)
                    .replace(/\s+/g, "");

            if (
                !isValidNigerianPhone(
                    cleanPhone
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid Nigerian phone number"
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
                    network
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid network"
                });
            }

            let selectedPlan = null;

            if (
                planId !== undefined &&
                planId !== null &&
                String(planId).trim() !== ""
            ) {
                selectedPlan =
                    db.prepare(`
                        SELECT *
                        FROM data_plans
                        WHERE id = ?
                        AND network = ?
                        AND status = 'active'
                    `).get(
                        Number(planId),
                        network
                    );

            } else if (plan) {
                selectedPlan =
                    db.prepare(`
                        SELECT *
                        FROM data_plans
                        WHERE network = ?
                        AND plan_name = ?
                        AND status = 'active'
                        LIMIT 1
                    `).get(
                        network,
                        String(plan)
                    );
            }

            if (!selectedPlan) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid or unavailable data plan"
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        balance,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please create a Purchase PIN before buying data"
                });
            }

            const pinCorrect =
                await bcrypt.compare(
                    pinString,
                    user.purchase_pin
                );

            if (!pinCorrect) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect Purchase PIN"
                });
            }

            const price =
                Number(
                    selectedPlan.selling_price
                );

            if (
                !Number.isFinite(price) ||
                price <= 0
            ) {
                return res.status(500).json({
                    success: false,
                    message:
                        "This data plan has an invalid price"
                });
            }

            if (
                Number(user.balance) < price
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient wallet balance"
                });
            }

            // --------------------------------------------------
            // IMPORTANT:
            // WiseSub purchase delivery is not being charged
            // here yet. We first verify that synchronization,
            // plans and pricing work correctly.
            // --------------------------------------------------

            return res.status(503).json({
                success: false,

                code:
                    "PROVIDER_INTEGRATION_PENDING",

                message:
                    "This plan is configured correctly, but WiseSub data delivery is not enabled yet. Your wallet has not been charged.",

                plan: {
                    id:
                        selectedPlan.id,

                    network:
                        selectedPlan.network,

                    plan_name:
                        selectedPlan.plan_name,

                    data_size:
                        selectedPlan.data_size,

                    selling_price:
                        selectedPlan.selling_price,

                    validity:
                        selectedPlan.validity
                }
            });

        } catch (error) {
            console.error(
                "Data purchase error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Data purchase failed"
            });
        }
    }
);

// ======================================================
// PURCHASE AIRTIME
// ======================================================

app.post(
    "/api/purchase-airtime",
    async (req, res) => {
        try {
            const {
                userId,
                network,
                phone,
                amount,
                pin
            } = req.body;

            const numericUserId =
                Number(userId);

            const airtimeAmount =
                Number(amount);

            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0 ||
                !network ||
                !phone ||
                pin === undefined
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please provide all purchase details including your Purchase PIN"
                });
            }

            const pinString =
                String(pin);

            if (
                !/^\d{4}$/.test(
                    pinString
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Purchase PIN must be exactly 4 digits"
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
                    network
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid network"
                });
            }

            const cleanPhone =
                String(phone)
                    .replace(/\s+/g, "");

            if (
                !isValidNigerianPhone(
                    cleanPhone
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter a valid Nigerian phone number"
                });
            }

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
                        "Airtime amount must be between ₦50 and ₦50,000"
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        balance,
                        purchase_pin
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            if (!user.purchase_pin) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please create a Purchase PIN before buying airtime"
                });
            }

            const pinCorrect =
                await bcrypt.compare(
                    pinString,
                    user.purchase_pin
                );

            if (!pinCorrect) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Incorrect Purchase PIN"
                });
            }

            if (
                Number(user.balance) <
                airtimeAmount
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Insufficient wallet balance"
                });
            }

            return res.status(503).json({
                success: false,

                code:
                    "PROVIDER_INTEGRATION_PENDING",

                message:
                    "Airtime delivery is not enabled yet. Your wallet has not been charged."
            });

        } catch (error) {
            console.error(
                "Airtime purchase error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Airtime purchase failed"
            });
        }
    }
);

// ======================================================
// USER TRANSACTIONS
// ======================================================

app.get(
    "/api/transactions/:userId",
    (req, res) => {
        try {
            const transactions =
                db.prepare(`
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
                `).all(
                    req.params.userId
                );

            res.json({
                success: true,
                transactions:
                    Array.isArray(
                        transactions
                    )
                        ? transactions
                        : []
            });

        } catch (error) {
            console.error(
                "Transactions error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load transactions",
                transactions: []
            });
        }
    }
);

// ======================================================
// ADMIN STATS
// ======================================================

app.get(
    "/api/admin/stats/:userId",
    requireAdmin,
    (req, res) => {
        try {
            const totalUsers =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM users
                `).get().count;

            const totalBalance =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(balance),
                            0
                        ) AS total
                    FROM users
                `).get().total;

            const totalTransactions =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM transactions
                `).get().count;

            const dataPurchases =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM transactions
                    WHERE (
                        type = 'data_purchase'
                        OR (
                            type = 'debit'
                            AND description LIKE '%data purchase%'
                        )
                    )
                    AND status = 'successful'
                `).get().count;

            const airtimePurchases =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM transactions
                    WHERE (
                        type = 'airtime_purchase'
                        OR (
                            type = 'debit'
                            AND description LIKE '%airtime purchase%'
                        )
                    )
                    AND status = 'successful'
                `).get().count;

            const totalRevenue =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM transactions
                    WHERE (
                        type = 'data_purchase'
                        OR type = 'airtime_purchase'
                        OR (
                            type = 'debit'
                            AND (
                                description LIKE '%data purchase%'
                                OR description LIKE '%airtime purchase%'
                            )
                        )
                    )
                    AND status = 'successful'
                `).get().total;

            const totalFunding =
                db.prepare(`
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM transactions
                    WHERE type = 'wallet_funding'
                    AND status = 'successful'
                `).get().total;

            res.json({
                success: true,

                stats: {
                    totalUsers,
                    totalBalance,
                    totalTransactions,
                    dataPurchases,
                    airtimePurchases,
                    totalRevenue,
                    totalFunding
                }
            });

        } catch (error) {
            console.error(
                "Admin stats error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load admin statistics"
            });
        }
    }
);

// ======================================================
// ADMIN USERS
// ======================================================

app.get(
    "/api/admin/users/:userId",
    requireAdmin,
    (req, res) => {
        try {
            const users =
                db.prepare(`
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
                users:
                    Array.isArray(users)
                        ? users
                        : []
            });

        } catch (error) {
            console.error(
                "Admin users error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load users",
                users: []
            });
        }
    }
);

// ======================================================
// ADMIN TRANSACTIONS
// ======================================================

app.get(
    "/api/admin/transactions/:userId",
    requireAdmin,
    (req, res) => {
        try {
            const transactions =
                db.prepare(`
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
                        ON users.id =
                           transactions.user_id
                    ORDER BY
                        transactions.id DESC
                    LIMIT 100
                `).all();

            res.json({
                success: true,
                transactions:
                    Array.isArray(
                        transactions
                    )
                        ? transactions
                        : []
            });

        } catch (error) {
            console.error(
                "Admin transactions error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Could not load admin transactions",
                transactions: []
            });
        }
    }
);

// ======================================================
// FORGOT PASSWORD
// ======================================================

app.post(
    "/api/forgot-password",
    (req, res) => {
        try {
            const email =
                String(
                    req.body.email || ""
                )
                    .trim()
                    .toLowerCase();

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter your email address."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        email
                    FROM users
                    WHERE LOWER(email) = ?
                `).get(email);

            if (!user) {
                return res.json({
                    success: true,
                    message:
                        "If an account exists with that email, password reset instructions will be provided."
                });
            }

            const resetToken =
                crypto
                    .randomBytes(32)
                    .toString("hex");

            const resetTokenHash =
                crypto
                    .createHash("sha256")
                    .update(resetToken)
                    .digest("hex");

            const expiresAt =
                Date.now() +
                (15 * 60 * 1000);

            db.prepare(`
                UPDATE users
                SET
                    reset_token_hash = ?,
                    reset_token_expires_at = ?
                WHERE id = ?
            `).run(
                resetTokenHash,
                expiresAt,
                user.id
            );

            const resetUrl =
                `http://localhost:3000/reset-password.html?token=${resetToken}`;

            console.log("");
            console.log(
                "======================================"
            );
            console.log(
                "PASSWORD RESET REQUEST"
            );
            console.log(
                "======================================"
            );
            console.log(
                `Email: ${user.email}`
            );
            console.log(
                `Reset link: ${resetUrl}`
            );
            console.log(
                "Expires in: 15 minutes"
            );
            console.log(
                "======================================"
            );
            console.log("");

            res.json({
                success: true,
                message:
                    "If an account exists with that email, password reset instructions will be provided."
            });

        } catch (error) {
            console.error(
                "Forgot password error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Something went wrong. Please try again."
            });
        }
    }
);

// ======================================================
// RESET PASSWORD
// ======================================================

app.post(
    "/api/reset-password",
    async (req, res) => {
        try {
            const {
                token,
                newPassword
            } = req.body;

            if (
                !token ||
                !newPassword
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Reset token and new password are required."
                });
            }

            if (
                String(newPassword).length < 6
            ) {
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
                db.prepare(`
                    SELECT
                        id,
                        reset_token_hash,
                        reset_token_expires_at
                    FROM users
                    WHERE reset_token_hash = ?
                `).get(tokenHash);

            if (!user) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This password reset link is invalid or has already been used."
                });
            }

            if (
                !user.reset_token_expires_at ||
                Date.now() >
                    Number(
                        user.reset_token_expires_at
                    )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This password reset link has expired. Please request a new one."
                });
            }

            const hashedPassword =
                await bcrypt.hash(
                    String(newPassword),
                    10
                );

            db.prepare(`
                UPDATE users
                SET
                    password = ?,
                    reset_token_hash = NULL,
                    reset_token_expires_at = NULL
                WHERE id = ?
            `).run(
                hashedPassword,
                user.id
            );

            res.json({
                success: true,
                message:
                    "Password reset successfully. You can now log in."
            });

        } catch (error) {
            console.error(
                "Reset password error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Something went wrong. Please try again."
            });
        }
    }
);

// ======================================================
// FUND WALLET - PAYSTACK
// ======================================================

app.post(
    "/api/fund-wallet",
    async (req, res) => {
        try {
            const {
                userId,
                amount
            } = req.body;

            const numericUserId =
                Number(userId);

            const fundingAmount =
                Number(amount);

            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid user account."
                });
            }

            if (
                !Number.isInteger(
                    fundingAmount
                ) ||
                fundingAmount < 100 ||
                fundingAmount > 500000
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Funding amount must be between ₦100 and ₦500,000."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        email
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });
            }

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {
                console.error(
                    "PAYSTACK_SECRET_KEY is missing."
                );

                return res.status(500).json({
                    success: false,
                    message:
                        "Payment system is not configured yet."
                });
            }

            const reference =
                `CD-${Date.now()}-${crypto
                    .randomBytes(6)
                    .toString("hex")}`;

            const amountInKobo =
                fundingAmount * 100;

            const paystackResponse =
                await fetch(
                    "https://api.paystack.co/transaction/initialize",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            email:
                                user.email,

                            amount:
                                String(
                                    amountInKobo
                                ),

                            currency:
                                "NGN",

                            reference,

                            metadata: {
                                user_id:
                                    String(
                                        user.id
                                    ),

                                purpose:
                                    "wallet_funding"
                            }
                        })
                    }
                );

            const paystackData =
                await paystackResponse.json();

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

            res.json({
                success: true,
                message:
                    "Payment initialized successfully.",

                authorization_url:
                    paystackData.data
                        .authorization_url,

                access_code:
                    paystackData.data
                        .access_code,

                reference:
                    paystackData.data
                        .reference
            });

        } catch (error) {
            console.error(
                "Fund wallet error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to initialize payment. Please try again."
            });
        }
    }
);

// ======================================================
// VERIFY PAYSTACK PAYMENT
// ======================================================

app.post(
    "/api/verify-wallet-payment",
    async (req, res) => {
        try {
            const {
                userId,
                reference
            } = req.body;

            const numericUserId =
                Number(userId);

            const paymentReference =
                String(
                    reference || ""
                ).trim();

            if (
                !Number.isInteger(
                    numericUserId
                ) ||
                numericUserId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid user account."
                });
            }

            if (!paymentReference) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment reference is required."
                });
            }

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Payment system is not configured yet."
                });
            }

            const user =
                db.prepare(`
                    SELECT
                        id,
                        email,
                        balance
                    FROM users
                    WHERE id = ?
                `).get(
                    numericUserId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User account not found."
                });
            }

            const existing =
                db.prepare(`
                    SELECT
                        id,
                        user_id,
                        amount,
                        status,
                        type
                    FROM transactions
                    WHERE reference = ?
                    LIMIT 1
                `).get(
                    paymentReference
                );

            if (existing) {
                if (
                    existing.user_id ===
                        numericUserId &&
                    existing.type ===
                        "wallet_funding"
                ) {
                    const currentUser =
                        db.prepare(`
                            SELECT balance
                            FROM users
                            WHERE id = ?
                        `).get(
                            numericUserId
                        );

                    return res.json({
                        success: true,
                        message:
                            "Payment has already been processed.",
                        balance:
                            currentUser.balance,
                        reference:
                            paymentReference,
                        alreadyProcessed:
                            true
                    });
                }

                return res.status(400).json({
                    success: false,
                    message:
                        "This payment reference has already been used."
                });
            }

            const paystackResponse =
                await fetch(
                    `https://api.paystack.co/transaction/verify/${encodeURIComponent(paymentReference)}`,
                    {
                        method: "GET",

                        headers: {
                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                        }
                    }
                );

            const paystackData =
                await paystackResponse.json();

            if (
                !paystackResponse.ok ||
                !paystackData.status ||
                !paystackData.data
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        paystackData.message ||
                        "Unable to verify payment."
                });
            }

            const payment =
                paystackData.data;

            if (
                payment.status !==
                "success"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        `Payment status is ${payment.status}.`
                });
            }

            if (
                payment.currency !==
                "NGN"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment currency."
                });
            }

            const metadataUserId =
                payment.metadata &&
                payment.metadata.user_id !==
                    undefined
                    ? String(
                        payment.metadata.user_id
                    )
                    : "";

            const paymentPurpose =
                payment.metadata &&
                payment.metadata.purpose
                    ? String(
                        payment.metadata.purpose
                    )
                    : "";

            if (
                metadataUserId !==
                String(user.id)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment does not belong to this account."
                });
            }

            if (
                paymentPurpose !==
                "wallet_funding"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment purpose."
                });
            }

            if (
                payment.customer &&
                payment.customer.email &&
                payment.customer.email
                    .toLowerCase() !==
                    user.email.toLowerCase()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment email does not match this account."
                });
            }

            const paidAmount =
                Number(payment.amount) /
                100;

            if (
                !Number.isFinite(
                    paidAmount
                ) ||
                paidAmount < 100 ||
                paidAmount > 500000
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid payment amount."
                });
            }

            const creditWallet =
                db.transaction(() => {

                    const duplicate =
                        db.prepare(`
                            SELECT id
                            FROM transactions
                            WHERE reference = ?
                            LIMIT 1
                        `).get(
                            paymentReference
                        );

                    if (duplicate) {
                        return false;
                    }

                    const updateResult =
                        db.prepare(`
                            UPDATE users
                            SET balance =
                                balance + ?
                            WHERE id = ?
                        `).run(
                            paidAmount,
                            user.id
                        );

                    if (
                        updateResult.changes !==
                        1
                    ) {
                        throw new Error(
                            "Wallet could not be updated."
                        );
                    }

                    db.prepare(`
                        INSERT INTO transactions (
                            user_id,
                            type,
                            amount,
                            status,
                            reference,
                            description
                        )
                        VALUES (
                            ?, ?, ?, ?, ?, ?
                        )
                    `).run(
                        user.id,
                        "wallet_funding",
                        paidAmount,
                        "successful",
                        paymentReference,
                        "Paystack wallet funding"
                    );

                    return true;
                });

            const wasCredited =
                creditWallet();

            const updatedUser =
                db.prepare(`
                    SELECT balance
                    FROM users
                    WHERE id = ?
                `).get(
                    user.id
                );

            if (!wasCredited) {
                return res.json({
                    success: true,
                    message:
                        "Payment has already been processed.",
                    balance:
                        updatedUser.balance,
                    reference:
                        paymentReference,
                    alreadyProcessed:
                        true
                });
            }

            res.json({
                success: true,
                message:
                    "Wallet funded successfully.",
                balance:
                    updatedUser.balance,
                amount:
                    paidAmount,
                reference:
                    paymentReference
            });

        } catch (error) {
            console.error(
                "Verify wallet payment error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to verify payment. Please try again."
            });
        }
    }
);

// ======================================================
// API STATUS
// ======================================================

app.get(
    "/api/status",
    (req, res) => {
        res.json({
            success: true,
            message:
                "CheapData API is running",
            server:
                "CheapData",
            port:
                PORT,
            wisesub:
                wiseSubConfigured()
                    ? "configured"
                    : "not configured",
            environment:
                WISESUB_ENVIRONMENT,
            markup:
                `${getMarkupPercent()}%`
        });
    }
);

// ======================================================
// API 404 HANDLER
// ======================================================

app.use(
    "/api",
    (req, res) => {
        res.status(404).json({
            success: false,
            message:
                "API endpoint not found"
        });
    }
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
    PORT,
    () => {
        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            "          CHEAPDATA SERVER"
        );
        console.log(
            "======================================"
        );
        console.log(
            `Local URL: http://localhost:${PORT}`
        );
        console.log(
            `WiseSub: ${
                wiseSubConfigured()
                    ? "CONFIGURED"
                    : "NOT CONFIGURED"
            }`
        );
        console.log(
            `WiseSub Environment: ${WISESUB_ENVIRONMENT}`
        );
        console.log(
            `Markup: ${getMarkupPercent()}%`
        );
        console.log(
            "======================================"
        );
        console.log("");
    }
);