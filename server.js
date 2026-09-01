const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Allow the server to receive JSON data
app.use(express.json());

// Serve our website
app.use(express.static(path.join(__dirname, "public")));

// Test API route
app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        message: "CheapData server is running 🚀"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`CheapData is running at http://localhost:${PORT}`);
});