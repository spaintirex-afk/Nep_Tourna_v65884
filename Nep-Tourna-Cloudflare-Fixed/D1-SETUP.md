# Nep Tourna — Cloudflare deployment

This version uses:

- Cloudflare Workers for the API/backend
- Cloudflare Workers Assets for the React/Vite frontend
- Cloudflare D1 for the shared database
- HttpOnly server sessions
- No Firebase
- No Vercel
- No better-sqlite3

## 1. Create the D1 database

Install Wrangler or use Cloudflare's web terminal if available, then run:

```bash
npx wrangler login
npx wrangler d1 create nep-tourna
```

Cloudflare will print a `database_id`.

Open `wrangler.toml` and replace:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with the ID Cloudflare gave you.

## 2. No SQL editor is required

Nep Tourna automatically creates its tables and indexes on the first API request and seeds the initial data if the database is empty.

The initial admin account is:

- Email: `admin@neptourna.local`
- Password: `admin@5678_9`

## 3. Deploy

```bash
npm install
npm run deploy
```

The deployment serves both the frontend and `/api/*` from the same Cloudflare Worker.

## 4. Important

Do not deploy the old Vercel configuration. Do not add `better-sqlite3` back to the project.

The browser never treats localStorage as the authoritative database. The D1 database is the shared source of truth.
