# CheapData Monorepo

CheapData is organized as a small npm monorepo so the frontend and backend are separated cleanly while remaining in one repository.

## Structure

```text
CHEAPDATA/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   └── server.js
│   │   ├── scripts/
│   │   │   ├── add-purchase-pin.js
│   │   │   ├── add-reset-fields.js
│   │   │   ├── fix-database.js
│   │   │   └── make-admin.js
│   │   └── package.json
│   │
│   └── web/
│       ├── *.html
│       ├── styles.css
│       └── package.json
│
├── data/
│   └── cheapdata.db
├── .env
├── .env.example
├── package.json
└── README.md
```

## Codespaces setup

From the repository root:

```bash
npm install
npm start
```

The server listens on the port configured by `PORT` (normally 3000).

## Database

The database is stored at `data/cheapdata.db` by default. You can override it with:

```env
DB_PATH=/absolute/path/to/cheapdata.db
```

## Important

Keep `.env` private and never commit it. Replace any real API credentials if you are sharing this repository.
