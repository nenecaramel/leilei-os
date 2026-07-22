# Phase 2 — Step 1: database foundation

This step adds PostgreSQL and Drizzle infrastructure without introducing any
application tables or changing the Phase 1 MCP tools.

## Environment

Copy `.env.example` to `.env` and set:

```env
DATABASE_URL=postgresql://user:password@host:5432/database
MCP_AUTH_TOKEN=replace-with-a-long-random-secret
MCP_USER_ID=00000000-0000-0000-0000-000000000000
```

`DATABASE_URL` and `MCP_USER_ID` remain optional at application startup during
Step 1 so that the deployed Phase 1 `hello` tool is not broken before the
database and user record exist. Drizzle migration commands require
`DATABASE_URL`.

## Migration workflow

After Step 2 adds the schema:

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

- `db:generate` creates versioned SQL migrations in `drizzle/`.
- `db:check` validates migration consistency.
- `db:migrate` applies pending migrations to the configured PostgreSQL database.

For Railway, link a PostgreSQL service to the application and provide
`DATABASE_URL`, `MCP_AUTH_TOKEN`, and `MCP_USER_ID` through Railway variables.
Do not store their values in the repository or Docker image.

Run migrations as an explicit deployment/release operation. Application
startup does not automatically mutate the database schema.
