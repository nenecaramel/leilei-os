# Leilei OS Deployment

This document describes the current `main`-based release path. It does not
contain credentials, connection strings, tokens, or private deployment URLs.

## Source of truth

- GitHub default branch: `main`.
- `main` is the only integration, development, and release trunk.
- Railway Production watches `main` for the root API/MCP service.
- Vercel Production watches `main` for the Web SPA under `web/`.

Feature and maintenance branches must enter `main` through a reviewed pull
request. A Draft PR is not production acceptance evidence.

## Railway API/MCP deployment

Railway builds the repository root `Dockerfile`. The multi-stage image compiles
the TypeScript service and starts `node dist/app/index.js` on the platform
provided `PORT`.

Before a new application release is promoted, `railway.json` runs:

```text
node dist/database/migrate.js
```

The pre-deploy runner performs a bounded database-readiness check, then uses
the checked-in `drizzle/` files and the LeileiOS-owned
`public.leilei_schema_migrations` ledger. On first bootstrap it validates the
legacy `drizzle.__drizzle_migrations` row. Bootstrap and pending migration SQL
are transactional; the runner fails closed on ledger, checksum, or SQL errors.

The current checked-in migration head is `0023_faulty_sphinx`, as recorded in
`drizzle/meta/_journal.json`.

Application startup itself does not run migrations. A successful deployment
must report a healthy service before production smoke checks continue.

## Vercel Web deployment

The Vercel project builds from the `web/` directory using:

```text
npm run build
```

The output directory is `web/dist`. `web/vercel.json` rewrites application
routes to `index.html` so authenticated SPA routes can be refreshed directly.
The Production Branch is `main`.

After deployment, verify the public homepage, `manifest.webmanifest`, and
`sw.js` before doing authenticated Web checks. Auth0 callback, logout, and Web
origin allowlists must contain the deployed Web origin.

## Local build and disposable migration verification

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm db:check
```

For the Web package:

```bash
cd web
npm ci
npm run typecheck
npm run build
```

Use only a disposable/local PostgreSQL instance for migration integration
tests. The manual Drizzle command is:

```bash
pnpm db:migrate
```

This command is separate from Railway's compiled pre-deploy runner. Never
point either command at production without an approved backup and release
procedure.

## Production verification

After a successful `main` deployment:

1. Confirm Railway and Vercel both report the expected `main` commit SHA.
2. Call `/health` through the public HTTPS API endpoint.
3. Confirm the MCP protected-resource metadata and authenticated `/mcp`
   handshake.
4. Verify representative Web routes and PWA assets.
5. If MCP definitions changed, refresh the ChatGPT app tool list and run only
   the approved smoke checks.

Never paste environment values or raw provider errors into Git, logs, tickets,
or screenshots.
