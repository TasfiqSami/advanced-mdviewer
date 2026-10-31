# Node.js 25/26 Deployment

The package supports Node.js 25 and 26. Node 25 reached end-of-life on March 31, 2026; use Node 26 LTS when your host offers it. See the [official Node.js release schedule](https://nodejs.org/en/about/previous-releases).

## Important database note

The application in this package uses SQLite (`node:sqlite`), not Neon PostgreSQL. There is no `DATABASE_URL`, PostgreSQL driver, Neon adapter, or Neon migration in this source. This package will create/use a SQLite file. Do not treat it as connected to Neon or configure it with a Neon connection string. A Neon deployment requires a separately implemented and tested SQLite-to-PostgreSQL migration; no database copy is performed by this guide.

SQLite is appropriate for a single application instance only when the host provides durable writable storage. Do not run multiple app instances against one SQLite file.

## Upload and install

1. Download `SYXLOR-MD-VIEWER-HOSTING-READY.zip` and extract its **contents** into the application directory configured by your Node.js hosting panel. The files should be directly in that directory; do not upload a parent folder containing them.
2. Select Node.js **26.x LTS** when available, or **25.x** if required by the hosting panel, and set the application root to this directory.
3. Configure the environment variables listed below in the panel. Do not upload a local `.env`.
4. Install dependencies with `npm ci`.
5. Build with `npm run build`.
6. Set the startup command to `npm start`.

The package includes the application source and reproducible lockfile. `npm start` runs the compiled server (`server-build/index.js`), serves the built `dist/` frontend, and listens on the hosting-provided `PORT` at `0.0.0.0`.

## Required environment

Set these in the hosting panel or in a private `.env` created in the application root:

| Variable | Required value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Leave to the hosting panel; the app reads its assigned port. |
| `APP_URL` | The exact public HTTPS origin, for example `https://notes.example.com`. |
| `OWNER_USERNAME` | Owner account name; defaults to `syxlor`. |
| `APP_PIN` | A private 6–12 digit PIN. Do not use `6969420` or another shared/example PIN. |
| `OWNER_PASSWORD` | Unique password, at least 12 characters. |
| `SESSION_SECRET` | Private random value, at least 32 characters. |
| `OWNER_RECOVERY_KEY` | A different private random value, at least 32 characters; store a backup offline. |

Generate `SESSION_SECRET` and `OWNER_RECOVERY_KEY` independently using your hosting panel's secure random generator or a trusted local password manager. Never put real values in `.env.example`, source control, or support logs.

Optional settings (defaults are shown):

| Variable | Default | Description |
|---|---:|---|
| `DATABASE_PATH` | `./data/syxlor.db` | SQLite file path, on a persistent writable volume. |
| `STORAGE_PATH` | `./storage` | Attachment directory, on persistent writable storage. |
| `MAX_UPLOAD_MB` | `20` | Server-enforced maximum image upload size; integer from 1 to 1024 MB. |
| `STORAGE_QUOTA_GB` | `10` | Application storage quota; integer from 1 to 1024 GB. |
| `TRUSTED_ORIGINS` | empty | Additional comma-separated exact origins; `APP_URL` is trusted automatically. |
| `TRUSTED_PROXY_IPS` | empty | Only documented reverse-proxy IPs, if the host requires trusting forwarded client IPs. |

The legacy `ACCESS_PIN` variable is accepted only in development for backward compatibility. Production requires `APP_PIN` explicitly and has no built-in PIN fallback.

## Domain, HTTPS, and uploads

1. Point the domain's DNS records to the hosting provider as directed by its panel.
2. Add the domain to the Node.js application and enable the provider's HTTPS/TLS certificate.
3. Set `APP_URL` to the final HTTPS origin (scheme and hostname, without a path). Restart the app after changing environment settings.
4. Ensure the provider's reverse-proxy/body upload limit is at least `MAX_UPLOAD_MB` plus multipart overhead. The application rejects files above its own configured limit regardless of proxy configuration.
5. Confirm `DATABASE_PATH` and `STORAGE_PATH` map to durable storage that survives restarts and deployments. Back up the SQLite database and attachments off-host. Do not expose either directory as public static content.

## Database initialization and migrations

The current SQLite schema is initialized safely with `CREATE TABLE IF NOT EXISTS` on startup. It does not drop existing tables. No separate migration command is required. Back up the database before upgrades and verify writable persistent storage before first production use.

This is not a Neon connection procedure: do not create or alter Neon tables based on this package. PostgreSQL schema creation, data migration, and switching the app's query layer remain outstanding work if Neon is a hard deployment requirement.

## Verify the deployment

- Visit `https://your-domain/` and confirm the sign-in page loads.
- Check `https://your-domain/api/v1/health`; it should return `{"status":"ok"}`.
- Sign in with the configured PIN or owner password.
- Create and edit a test document, upload an allowed image under the configured size, restart the application, and confirm the data persists.
- Check the hosting logs for startup errors. Never paste secrets or PIN values into logs or tickets.

## Troubleshooting

- **Startup says `APP_PIN` is required:** Set a private production PIN of 6–12 digits and restart.
- **Startup rejects `APP_URL`:** Use a valid absolute URL with `https://` and ensure it matches the site's public origin.
- **Startup rejects a numeric setting:** `PORT`, `MAX_UPLOAD_MB`, and `STORAGE_QUOTA_GB` must be whole numbers in their supported ranges; leave `PORT` to the host if it supplies one.
- **Upload rejected:** Check the application's `MAX_UPLOAD_MB` and increase the hosting proxy limit if needed.
- **Database/storage write error:** Confirm the configured directories exist or can be created and the Node.js process has read/write access. Confirm the host's storage is persistent.
- **Health endpoint unavailable:** Confirm Node.js 25 or 26 is selected, `npm ci` and `npm run build` completed, the startup command is `npm start`, and the hosting panel passed its assigned `PORT`.
- **Need Neon/PostgreSQL:** This package does not implement it. A safe migration needs a Neon connection configured privately, a verified schema/data migration, and integration tests before directing production traffic.
