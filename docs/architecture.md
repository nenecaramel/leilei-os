# Leilei OS Architecture

## Current product

Leilei OS is an authenticated personal workspace composed of:

- a React Web application protected by its own Auth0 audience and scope;
- a PostgreSQL-backed Express API with domain services and repositories;
- an OAuth-protected Streamable HTTP MCP server; and
- a PWA runtime for the Web application.

ChatGPT remains the MCP client and user-facing conversation layer. Leilei OS
does not call the OpenAI API and does not store ChatGPT conversation history.

## Runtime boundaries

```text
Web / ChatGPT MCP client
          │ authenticated request
          ▼
Express Web API / MCP router
          │ server-owned identity
          ▼
Domain services
          │ validation, ownership, lifecycle, concurrency
          ▼
Repositories ───────────────► PostgreSQL
          │
          └──────────────► Notion API (server-only PAT, explicit MCP tools)
```

The Web API and MCP tools share domain services and repositories. Tool handlers
do not query PostgreSQL directly. User identity is resolved from authenticated
server context; clients cannot submit or select a database user ID.

## Web application

The Web application contains authenticated Dashboard and Day Space views plus
Memory, Diary, Task, Todo, Universe, Global Search, and System routes. Durable
data is read and written through `/api/v1`; the server remains authoritative.
The Web does not use IndexedDB or implicit dual-write as a substitute for the
server data model.

The PWA build emits the manifest and service worker from `web/`. Vercel serves
the built SPA from `web/dist` with history fallback. Production source is
`main`.

## MCP surface

Authenticated production MCP sessions include tools for:

- local context and weather;
- Memory, Diary, Task, and Todo reads/writes;
- Toy command control when its bridge is configured;
- Global Search and Universe search/node/relation reads;
- Notion connection, page, database, data-source, and parameterized query reads;
- explicit `write_notion_page` and `write_notion_comment` actions.

The explicit Notion writes perform server-side authentication, fresh-read
preconditions, and readback verification. The older broad Notion registrar is
kept only for focused compatibility/security tests and is not wired into the
production MCP router.

MCP schemas are Zod-validated. Safe error mappings distinguish invalid input,
missing resources, authorization failures, conflicts, unavailable providers,
and service failures without exposing credentials, connection strings, SQL, or
stack traces.

### MCP session lifecycle

Streamable HTTP sessions are process-local and namespaced: `/mcp` uses the
`public` namespace and `/internal/mcp` uses `internal`. The default governance
limits are eight sessions per user and namespace, 32 sessions per Node process,
two hours idle TTL, and 24 hours absolute TTL. These are intentionally not
cross-replica limits. Expired sessions are reclaimed lazily before capacity
checks; no permanent process timer is required. MCP write idempotency rows are
retained for 30 days by default and cleaned at most every 24 hours. Tool
activity remains durable in `tool_calls` and is not coupled to that finite retry
ledger window.

## Database and migrations

PostgreSQL holds durable user, content, Todo, Universe, audit, and integration
state. The checked-in migration chain currently ends at
`0023_faulty_sphinx` in `drizzle/meta/_journal.json`.

Railway runs the compiled migration entrypoint
`node dist/database/migrate.js` as its pre-deploy command. The runner performs
readiness checks, uses the LeileiOS-owned
`public.leilei_schema_migrations` ledger, cross-checks the legacy
`drizzle.__drizzle_migrations` ledger when bootstrapping, and applies pending
checked-in migrations transactionally.

The normal application start command does not run migrations. Manual local or
disposable-database checks use the package scripts and must never be pointed at
production without the approved backup and release procedure.

## Deployment topology

- GitHub default branch and release trunk: `main`.
- Railway Production source: `main`; the root Dockerfile builds the API/MCP
  service and the platform supplies `PORT`.
- Vercel Production Branch: `main`; Vercel builds `web/` and serves the SPA.
- Production credentials and database URLs stay in platform secret stores.

## Security constraints

- OAuth issuer, audience, signature, scope, subject, and Web origin checks are
  enforced server-side.
- Authenticated ownership is applied in domain services and repositories.
- `DATABASE_URL`, OAuth credentials, MCP tokens, bridge keys, and `NOTION_PAT`
  are server-only and must never be logged, returned, or committed.
- Notion access is limited by the configured PAT's permissions; Leilei OS does
  not silently synchronize or merge Notion data into its canonical domains.
- Database migrations, imports, and other durable writes require explicit
  release/operation ownership; no production mutation is hidden in a read path.
