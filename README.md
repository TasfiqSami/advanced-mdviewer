# Syxlor MD Viewer

A private Markdown workspace with autosave, folders, tags, revision history, image attachments, themes, reading mode, exports, and an in-browser converter.

## Database architecture

This checkout uses Node's built-in SQLite driver and a local SQLite database (`DATABASE_PATH`). It does **not** currently connect to Neon or PostgreSQL. There is no `DATABASE_URL`, Postgres driver, or PostgreSQL migration in this project. The hosting package therefore remains SQLite-backed; do not point this build at Neon or assume SQLite data has been migrated. A Neon rollout needs a separately planned, data-preserving database migration and verification against the actual Neon project.

## Local development

1. Use Node.js 25 or 26 and npm. Node 25 is end-of-life; Node 26 LTS is recommended when available.
2. Copy `.env.example` to `.env`.
3. Set a unique `OWNER_PASSWORD` (at least 12 characters). For PIN login, set `APP_PIN` to 6–12 digits; do not use a public/default PIN.
4. Run `npm ci`.
5. Run `npm run dev` and open `http://127.0.0.1:5173`.

The owner account and welcome document are initialized only when the SQLite database is empty. The database and attachments are stored in `data/` and `storage/`; keep both on persistent storage and back them up.

## Production

Set `NODE_ENV=production`, `APP_URL` to the HTTPS site origin, `APP_PIN`, `OWNER_PASSWORD`, `SESSION_SECRET`, and `OWNER_RECOVERY_KEY`. The PIN, session secret, and recovery key must not be checked into source control. Configure `MAX_UPLOAD_MB` and ensure the hosting/proxy request limit is at least as large as the application limit. Only trust documented proxy IPs in `TRUSTED_PROXY_IPS`.

Build with `npm run build`; start with `npm start`. The server binds to `0.0.0.0` and the platform-provided `PORT`. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the Node.js 25 hosting guide and package commands.

## Features

The Converter supports Markdown, text, HTML, PDF, DOCX, and ZIP input and output where supported. Conversion runs in the browser. Complex imported PDF/DOCX layouts, images, and embedded media may not be preserved. Legal pages are general-purpose drafts and should be adapted to the actual hosting, backup, and data-retention configuration.

## Commands

- `npm run dev` — start the API and Vite development server.
- `npm run build` — build the frontend and compile the production server.
- `npm test` — run unit tests.
- `npm start` — run the compiled server and serve the frontend build.
- `npm run package:hosting` — build and create `hosting-ready/` plus `SYXLOR-MD-VIEWER-HOSTING-READY.zip`.
