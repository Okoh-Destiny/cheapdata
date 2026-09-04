require("dotenv").config();
const axios = require("axios");

async function testWiseSub() {
    try {
        const response = await axios.get(
            `${process.env.WISESUB_BASE_URL}/services`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.WISESUB_API_KEY}`,
                    "X-API-Secret": process.env.WISESUB_API_SECRET,
                    "X-Environment": process.env.WISESUB_ENVIRONMENT,
                    Accept: "application/json"
                }
            }
        );

        console.log("✅ WiseSub connection successful!");
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.log("❌ WiseSub connection failed!");

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

testWiseSub();