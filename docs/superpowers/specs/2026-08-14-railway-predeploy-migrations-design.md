# Railway Pre-Deploy Migrations Design

## Goal

Ensure production database migrations run automatically before a new Railway application deployment begins serving traffic, so Phase 7.4 migration `0018_nifty_power_pack.sql` and future Drizzle migrations cannot be skipped silently.

## Design

Use Railway's pre-deploy command. The command runs inside the built application image, has access to Railway environment variables, and blocks the deployment when it exits non-zero.

Add a small production migration entrypoint under `src/database/migrate.ts`. It reads `DATABASE_URL`, opens the same PostgreSQL/Drizzle stack used by the application, runs `drizzle-orm/postgres-js/migrator` against the packaged `drizzle/` folder, then closes the connection. Missing `DATABASE_URL` or migration failure must exit non-zero.

The Docker runtime image must include the checked-in `drizzle/` migration folder. Add `railway.json` with `deploy.preDeployCommand` pointing to the compiled migration entrypoint. Do not alter the normal application start command.

## Safety

- No ad-hoc SQL and no destructive migration behavior.
- Migrations remain the checked-in Drizzle migration history.
- A failed migration prevents the new Railway deployment from going live.
- Existing application startup remains unchanged.
- No migration runs on every app process start; it runs only in Railway pre-deploy.
- No secrets are logged.

## Verification

Add repository-level tests that assert the runtime image contains migrations and Railway invokes the compiled migration entrypoint. Run typecheck/build/full tests before merge. After merge, require Railway deployment success, then verify public `/health`; Phase 7.4 Restore execute remains blocked until the deployment proves the migration hook succeeded.