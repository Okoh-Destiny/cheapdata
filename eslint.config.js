const globals = require("globals");

module.exports = [
    {
        ignores: [
            "node_modules/**",
            "apps/api/data/**",
            "cheapdata-progress.zip"
        ]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser
            }
        },
        rules: {
            "no-const-assign": "error",
            "no-dupe-keys": "error",
            "no-duplicate-case": "error",
            "no-unreachable": "error",
            "no-undef": "error",
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
        }
    }
];
