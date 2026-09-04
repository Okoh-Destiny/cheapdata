require("dotenv").config();
const axios = require("axios");

async function getPlans(network) {
    try {
        const response = await axios.get(
            `${process.env.WISESUB_BASE_URL}/packages`,
            {
                params: {
                    service_type: "data",
                    provider_code: network
                },
                headers: {
                    Authorization: `Bearer ${process.env.WISESUB_API_KEY}`,
                    "X-API-Secret": process.env.WISESUB_API_SECRET,
                    "X-Environment": process.env.WISESUB_ENVIRONMENT,
                    Accept: "application/json"
                }
            }
        );

        console.log(`\n================ ${network.toUpperCase()} ================`);
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.log(`\n❌ Failed to get ${network} plans`);

        if (error.response) {
            console.log("Status:", error.response.status);
            console.log(
                JSON.stringify(error.response.data, null, 2)
            );
        } else {
            console.log(error.message);
        }
    }
}

async function testWiseSubPlans() {
    console.log("🚀 Checking WiseSub data plans...\n");

    await getPlans("mtn");
    await getPlans("glo");
    await getPlans("airtel");
    await getPlans("9mobile");
}

testWiseSubPlans();