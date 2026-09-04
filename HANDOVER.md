# CheapData Handover

## Project overview

CheapData is a Node.js monorepo for data and airtime reselling. Users register,
log in, manage a purchase PIN, fund a wallet through Paystack, and purchase
mobile data or airtime. Administrators can review platform statistics, users,
and transactions. WiseSub utilities synchronize provider plans and inspect the
provider API.

## Repository layout

- `apps/api/src/server.js`: Express server, SQLite access, authentication,
  wallet operations, purchases, transactions, password reset, and admin routes.
- `apps/api/data/`: Local SQLite database and SQLite journal files. These files
  are ignored by Git.
- `apps/api/scripts/`: Database maintenance, admin setup, and WiseSub utility
  scripts.
- `apps/web/`: Static customer and admin HTML pages plus shared CSS. The API
  serves this directory.
- `package.json`: npm workspace root and commands that delegate to the API.
- `.env.example`: Configuration variable template. Keep real values in the
  untracked `.env` file.

## Local development

From the repository root:

```bash
npm install
npm run dev
```

The development server uses nodemon and listens on `http://localhost:3000` by
default. Run the production-style process with:

```bash
npm start
```

The root database commands are:

```bash
npm run db:fix
npm run db:reset-fields
npm run db:purchase-pin
npm run make-admin
```

WiseSub commands run in the API workspace:

```bash
npm run wise:sync --workspace=@cheapdata/api
npm run wise:test --workspace=@cheapdata/api
npm run wise:test-mtn --workspace=@cheapdata/api
npm run wise:test-plans --workspace=@cheapdata/api
npm run wise:test-pricing --workspace=@cheapdata/api
```

Configure the variables already listed in `.env.example`, including
`SESSION_SECRET`, `PAYSTACK_SECRET_KEY`, `DB_PATH`, the WiseSub variables, and
`CHEAPDATA_MARKUP_PERCENT`. Do not put secret values in this document or in
source control. The default database path is
`./apps/api/data/cheapdata.db`.

## Core API areas

- Authentication: registration, login, logout, session checks, password reset,
  and purchase PIN management.
- Wallet: development-only test funding and Paystack payment initialization.
- Purchases: authenticated data and airtime purchase endpoints, with balance
  and purchase PIN validation.
- Transactions: authenticated user transaction history and admin transaction
  views.
- Admin: protected platform statistics, user listing, and transaction listing.
- Provider integration: WiseSub plan synchronization and diagnostic scripts in
  `apps/api/scripts/`.

Important routes include `/api/register`, `/api/login`, `/api/logout`,
`/api/fund-wallet`, `/api/purchase-data`, `/api/purchase-airtime`,
`/api/forgot-password`, and `/api/reset-password`. Admin routes are under
`/api/admin/` and require an authenticated administrator session.

## Known issues and TODOs

- `SESSION_SECRET` must be configured before production deployment. Development
  falls back to an insecure value and logs a warning.
- `/api/test-fund` is intentionally available only outside production. It must
  not be used as a real payment flow.
- Paystack wallet funding requires a valid `PAYSTACK_SECRET_KEY` and a complete
  payment verification flow in the deployment environment. Test the full
  redirect and verification path before launch.
- WiseSub synchronization and diagnostic commands require valid provider
  credentials and network access. Run them against the intended provider
  environment before changing production plan data.
- The local SQLite database is not source-controlled. Provision or restore the
  database separately when setting up another environment.
- The web workspace has no build step; its HTML and CSS are served directly by
  the API. Add a separate frontend build configuration only if the frontend is
  migrated to a framework.

## Current verification

The cleaned workspace has been validated with `node --check` on project
JavaScript files, `npm install`, a SQLite read/write check, and `npm run dev`.
The server starts at `http://localhost:3000` without module or database path
errors.
