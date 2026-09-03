const axios = require("axios");
const Database = require("better-sqlite3");
require("dotenv").config();

const db = new Database("cheapdata.db");

const BASE_URL =
    process.env.WISESUB_BASE_URL ||
    "https://app.wisesub.com.ng/api/partner/v1";

const NETWORKS = [
    { name: "MTN", code: "mtn" },
    { name: "Airtel", code: "airtel" },
    { name: "Glo", code: "glo" },
    { name: "9mobile", code: "9mobile" }
];

function getHeaders() {
    return {
        Authorization: `Bearer ${process.env.WISESUB_API_KEY || ""}`,
        "X-API-Secret": process.env.WISESUB_API_SECRET || "",
        "X-Environment": process.env.WISESUB_ENVIRONMENT || "test",
        Accept: "application/json"
    };
}

function calculateSellingPrice(providerCost) {
    const markupPercent = Number(
        process.env.CHEAPDATA_MARKUP_PERCENT || 5
    );

    return Math.ceil(
        Number(providerCost) * (1 + markupPercent / 100)
    );
}

/*
 * We only want actual data bundles.
 * Exclude airtime-like, voice, social and entertainment packages.
 */
function isValidDataPackage(packageName) {
    const name = String(packageName || "").toLowerCase();

    const excludedWords = [
        "xtratalk",
        "voice",
        "airtime",
        "tv",
        "vod",
        "telegram",
        "instagram",
        "tiktok",
        "youtube",
        "opera",
        "social",
        "myg",
        "wtf"
    ];

    if (excludedWords.some(word => name.includes(word))) {
        return false;
    }

    return (
        name.includes("mb") ||
        name.includes("gb") ||
        name.includes("tb")
    );
}

async function syncNetwork(network) {
    console.log(`\n================ ${network.name} ================`);

    try {
        const response = await axios.get(
            `${BASE_URL}/packages`,
            {
                params: {
                    service_type: "data",
                    provider_code: network.code
                },
                headers: getHeaders(),
                timeout: 15000
            }
        );

        const packages =
            response.data?.data?.packages || [];

        console.log(`WiseSub packages received: ${packages.length}`);

        let added = 0;
        let updated = 0;
        let skipped = 0;

        for (const pkg of packages) {
            const packageCode = String(
                pkg.package_code || ""
            ).trim();

            const packageName = String(
                pkg.package_name || ""
            ).trim();

            const providerCost = Number(pkg.price);

            if (
                !packageCode ||
                !packageName ||
                !Number.isFinite(providerCost) ||
                providerCost <= 0
            ) {
                skipped++;
                continue;
            }

            if (!isValidDataPackage(packageName)) {
                skipped++;
                continue;
            }

            const sellingPrice =
                calculateSellingPrice(providerCost);

            /*
             * Extract a cleaner plan name.
             *
             * Example:
             * "N600 2.5GB - 2 days"
             * becomes:
             * "2.5GB - 2 days"
             */
            let cleanPlanName = packageName
                .replace(/^N[\d,]+\s*/i, "")
                .trim();

            if (!cleanPlanName) {
                cleanPlanName = packageName;
            }

            /*
             * Try to determine the data size.
             */
            const sizeMatch = cleanPlanName.match(
                /(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)/i
            );

            const dataSize = sizeMatch
                ? sizeMatch[0]
                : cleanPlanName;

            /*
             * Extract validity when possible.
             */
            let validity = "";

            const validityMatch = cleanPlanName.match(
                /(\d+)\s*(hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years)/i
            );

            if (validityMatch) {
                validity = validityMatch[0];
            }

            /*
             * First look for an existing record
             * using the WiseSub package code.
             */
            const existingByCode = db.prepare(`
                SELECT id
                FROM data_plans
                WHERE network = ?
                  AND provider_package_code = ?
                LIMIT 1
            `).get(
                network.name,
                packageCode
            );

            if (existingByCode) {
                db.prepare(`
                    UPDATE data_plans
                    SET
                        plan_name = ?,
                        data_size = ?,
                        provider_cost = ?,
                        selling_price = ?,
                        status = 1,
                        provider = 'wisesub',
                        provider_code = ?,
                        provider_package_code = ?,
                        provider_package_name = ?,
                        validity = ?,
                        source = 'wisesub',
                        last_synced_at = datetime('now')
                    WHERE id = ?
                `).run(
                    cleanPlanName,
                    dataSize,
                    providerCost,
                    sellingPrice,
                    network.code,
                    packageCode,
                    packageName,
                    validity,
                    existingByCode.id
                );

                updated++;
                continue;
            }

            /*
             * Because data_plans has:
             *
             * UNIQUE(network, plan_name)
             *
             * we must also check whether the cleaned
             * plan name already exists.
             */
            const existingByName = db.prepare(`
                SELECT id
                FROM data_plans
                WHERE network = ?
                  AND plan_name = ?
                LIMIT 1
            `).get(
                network.name,
                cleanPlanName
            );

            if (existingByName) {
                db.prepare(`
                    UPDATE data_plans
                    SET
                        data_size = ?,
                        provider_cost = ?,
                        selling_price = ?,
                        status = 1,
                        provider = 'wisesub',
                        provider_code = ?,
                        provider_package_code = ?,
                        provider_package_name = ?,
                        validity = ?,
                        source = 'wisesub',
                        last_synced_at = datetime('now')
                    WHERE id = ?
                `).run(
                    dataSize,
                    providerCost,
                    sellingPrice,
                    network.code,
                    packageCode,
                    packageName,
                    validity,
                    existingByName.id
                );

                updated++;
                continue;
            }

            /*
             * Brand-new package.
             */
            db.prepare(`
                INSERT INTO data_plans (
                    network,
                    plan_name,
                    data_size,
                    provider_cost,
                    selling_price,
                    status,
                    provider,
                    provider_code,
                    provider_package_code,
                    provider_package_name,
                    validity,
                    source,
                    last_synced_at
                )
                VALUES (?, ?, ?, ?, ?, 1, 'wisesub', ?, ?, ?, ?, ?, datetime('now'))
            `).run(
                network.name,
                cleanPlanName,
                dataSize,
                providerCost,
                sellingPrice,
                network.code,
                packageCode,
                packageName,
                validity,
                "wisesub"
            );

            added++;
        }

        console.log(`Added:   ${added}`);
        console.log(`Updated: ${updated}`);
        console.log(`Skipped: ${skipped}`);

        return {
            added,
            updated,
            skipped,
            failed: 0
        };

    } catch (error) {
        console.log(`❌ ${network.name} sync failed`);

        if (error.response) {
            console.log("HTTP Status:", error.response.status);
            console.log(
                "Response:",
                JSON.stringify(
                    error.response.data,
                    null,
                    2
                )
            );
        } else {
            console.log(
                "Error:",
                error.message
            );
        }

        return {
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 1
        };
    }
}

async function main() {
    console.log("🚀 CheapData WiseSub Data Plan Sync");
    console.log("====================================");

    if (!process.env.WISESUB_API_KEY) {
        console.error("❌ WISESUB_API_KEY is missing from .env");
        process.exit(1);
    }

    if (!process.env.WISESUB_API_SECRET) {
        console.error("❌ WISESUB_API_SECRET is missing from .env");
        process.exit(1);
    }

    console.log(
        "Environment:",
        process.env.WISESUB_ENVIRONMENT || "test"
    );

    console.log(
        "Base URL:",
        BASE_URL
    );

    const totals = {
        added: 0,
        updated: 0,
        skipped: 0,
        failed: 0
    };

    for (const network of NETWORKS) {
        const result = await syncNetwork(network);

        totals.added += result.added;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
        totals.failed += result.failed;
    }

    console.log("\n====================================");
    console.log("✅ SYNC FINISHED");
    console.log("====================================");
    console.log("Added:   ", totals.added);
    console.log("Updated: ", totals.updated);
    console.log("Skipped: ", totals.skipped);
    console.log("Failed:  ", totals.failed);

    /*
     * Show the plans currently stored in CheapData.
     */
    const plans = db.prepare(`
        SELECT
            id,
            network,
            plan_name,
            provider_cost,
            selling_price,
            provider_package_code
        FROM data_plans
        WHERE source = 'wisesub'
          AND status = 1
        ORDER BY
            network,
            selling_price ASC
    `).all();

    console.log("\n📦 ACTIVE WISESUB PLANS IN CHEAPDATA");
    console.log("====================================");

    if (plans.length === 0) {
        console.log("No active WiseSub plans were added.");
    } else {
        for (const plan of plans) {
            console.log(
                `${plan.network} | ${plan.plan_name} | Provider ₦${plan.provider_cost} | Sell ₦${plan.selling_price} | ${plan.provider_package_code}`
            );
        }
    }

    db.close();

    if (totals.failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error("❌ Sync crashed:");
    console.error(error);
    db.close();
    process.exit(1);
});