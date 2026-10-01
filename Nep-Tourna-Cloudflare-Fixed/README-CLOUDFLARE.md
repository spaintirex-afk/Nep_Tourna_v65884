# Nep Tourna — Cloudflare Workers + D1

This archive is arranged with the project files at the **repository root**. Do not upload the parent folder itself as an extra directory.

## Cloudflare Workers Build

Build command:
```bash
npm install && npm run build
```

Deploy command:
```bash
npx wrangler deploy
```

If Cloudflare provides one combined command, use:
```bash
npm install && npm run build && npx wrangler deploy
```

## D1

Before the first production deployment, create the D1 database:
```bash
npx wrangler d1 create nep-tourna
```

Copy the returned `database_id` into `wrangler.toml`, replacing:
`REPLACE_WITH_YOUR_D1_DATABASE_ID`

The Worker initializes the application tables automatically on startup.

## Admin

Email: `admin@neptourna.local`
Password: `admin@5678_9`

Do not expose production secrets in GitHub. Change the admin password after first login if you use this deployment publicly.
