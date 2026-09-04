const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const testDatabasePath = path.join(
    __dirname,
    "../data/cheapdata.test.db"
);

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-only-session-secret";
process.env.DB_PATH = testDatabasePath;

const { app, db } = require("../src/app");

function request(server, requestPath) {
    return new Promise((resolve, reject) => {
        const request = http.get(server.address().address === "::"
            ? `http://localhost:${server.address().port}${requestPath}`
            : `http://${server.address().address}:${server.address().port}${requestPath}`,
        response => {
            let body = "";

            response.setEncoding("utf8");
            response.on("data", chunk => body += chunk);
            response.on("end", () => resolve({
                statusCode: response.statusCode,
                body
            }));
        });

        request.on("error", reject);
    });
}

async function run() {
    const server = app.listen(0);

    try {
        const status = await request(server, "/api/status");
        assert.strictEqual(status.statusCode, 200);
        assert.strictEqual(JSON.parse(status.body).success, true);

        const page = await request(server, "/index.html");
        assert.strictEqual(page.statusCode, 200);
        assert.match(page.body, /CheapData/i);

        console.log("API test environment smoke test passed");
    } finally {
        await new Promise(resolve => server.close(resolve));
        db.close();
        for (const suffix of ["", "-shm", "-wal"]) {
            const filePath = `${testDatabasePath}${suffix}`;
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});