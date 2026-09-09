# Leilei OS Architecture

## Current system

Leilei OS is an authenticated personal workspace composed of:

- a React Web application protected by its own Auth0 audience and scope;
- a PostgreSQL-backed Express API with domain services and repositories;
- an OAuth-protected Streamable HTTP MCP server;
- MCP Apps UI resources for interactive model-facing surfaces; and
- a PWA runtime for the Web application.

ChatGPT is one MCP client and conversation surface. Leilei OS does not call the OpenAI API and does not store ChatGPT conversation history.

## Runtime boundaries

```text
Web / MCP client / MCP Apps host
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

The Web API and MCP tools share domain services and repositories. Tool handlers do not select a database user ID supplied by a client. User identity is resolved from authenticated server context before domain code accesses persisted data.

## OAuth authorization boundary

The public `/mcp` path verifies configured OAuth issuer, audience, scope, signature, and allowed subject before a session reaches domain tools.

An optional Auth0-backed local authorization adapter can be enabled with `OAUTH_AS_ENABLED=true`. It keeps Auth0 as the identity and token issuer, resolves configured static clients first, and can resolve only explicitly trusted CIMD client-metadata URLs over the repository's bounded HTTPS fetch path. Authorization codes are short-lived, single-use, and bound to the exact client, redirect URI, scope, resource, audience, and PKCE S256 challenge.

The adapter is configuration-dependent; repository support for it does not by itself prove that it is enabled in a particular live environment. Production state must be verified from deployment configuration rather than inferred from this document.

## Web application

The Web application contains authenticated Dashboard and Day Space views plus Memory, Diary, Task, Todo, Universe, Global Search, and System routes. Durable data is read and written through `/api/v1`; the server remains authoritative.

The PWA build emits the manifest and service worker from `web/`. Vercel serves the built SPA from `web/dist` with history fallback. The production branch is `main`.

## MCP surface

The authenticated production MCP router registers the current LeileiOS tool surface, including personal workspace reads/writes, Global Search and Universe operations, Notion reads/writes, Toy/bridge operations when configured, and MCP Apps resources.

Notion tools use server-side authorization. `read_notion_page` exposes a plain schema with optional `page_id` and `page_url` fields and enforces exactly one reference inside the handler, returning `INVALID_PAGE_REFERENCE` for missing or ambiguous references. Explicit Notion page/comment writes use fresh-read and readback verification. Destructive Notion delete/archive operations are not exposed.

MCP schemas are Zod-validated. Safe error mappings distinguish invalid input, missing resources, authorization failures, conflicts, unavailable providers, and service failures without exposing credentials, connection strings, SQL, or stack traces.

### Thinking Block

`render_thinking_block` renders model-supplied external working text in an MCP Apps card. It does not expose native hidden chain of thought. Thinking-block content is not persisted by default and does not become authoritative long-term state merely by being rendered.

The standard MCP Apps resource is `ui://widget/leileios-thinking-block-v2.html`. ChatGPT's `openai/outputTemplate` compatibility path points to `ui://widget/leileios-thinking-block-v1.html`. Both identifiers resolve to the same current HTML and browser runtime; the v1 identifier exists only as a host-compatibility alias.

The browser client uses the official `@modelcontextprotocol/ext-apps` `App` and `PostMessageTransport` lifecycle for standard MCP Apps hosts while retaining the OpenAI host globals path as a compatibility fallback. The generated Thinking Block browser bundle is produced by `scripts/build-thinking-block-browser.mjs` during the root build.

### Message Bridge MCP App

The Message Bridge resource is currently registered as:

```text
ui://leileios/message-bridge/v5
```

The browser client uses the official `@modelcontextprotocol/ext-apps` `App` and `PostMessageTransport` runtime. `pnpm build` runs `scripts/build-bridge-browser.mjs` after TypeScript compilation to generate the browser bundle consumed by the resource.

Host initialization can run when the resource iframe loads, but listener activation is deliberately manual. The Bridge UI calls `bridge_listener_start` only after the user activates **Start**; it does not automatically begin listener polling/delivery.

The resource URI is also a cache/version boundary. Material UI/runtime changes should advance the URI rather than assuming all MCP Apps hosts will invalidate cached resource contents.

Bridge queue, reservation, dispatch, delivery, and Sentinel wake semantics remain server/domain responsibilities; the MCP Apps client does not redefine them.

## MCP session lifecycle

Streamable HTTP sessions are process-local and namespaced: `/mcp` uses the public namespace and `/internal/mcp` uses the internal namespace. Session governance and idempotency retention are enforced by the server implementation; they are not cross-replica distributed locks.

## Database and migrations

PostgreSQL holds durable user, content, Todo, Universe, audit, integration, Sentinel, and related application state.

The checked-in Drizzle migration chain currently ends at:

```text
0033_health_v2_daily_summaries
```

The canonical checked-in source for that value is `drizzle/meta/_journal.json`.

Railway runs `node dist/database/migrate.js` as the configured pre-deploy command. The runner performs readiness checks, uses the LeileiOS-owned `public.leilei_schema_migrations` ledger, cross-checks the legacy Drizzle ledger when bootstrapping, and applies pending checked-in migrations transactionally.

Normal application startup does not run migrations. Manual local or disposable-database checks must never be pointed at production without an approved backup and release procedure.

## Deployment topology

- GitHub default branch and release trunk: `main`.
- Railway Production source: `main`; the root `Dockerfile` builds the API/MCP service and includes both MCP Apps browser build steps (Message Bridge and Thinking Block).
- `railway.json` configures the compiled migration runner as pre-deploy work.
- Vercel Production Branch: `main`; Vercel builds `web/` and serves the SPA.
- Production credentials and database URLs stay in platform secret stores.

Repository architecture describes code/configuration on `main`. It must not be used as evidence that a particular commit has already reached production; verify deployment SHA and health separately.

## Security constraints

- OAuth issuer, audience, signature, scope, subject, and Web origin checks are enforced server-side.
- Authenticated ownership is applied in domain services and repositories.
- `DATABASE_URL`, OAuth credentials, MCP tokens, bridge keys, and `NOTION_PAT` are server-only and must never be logged, returned, or committed.
- Notion access is limited by the configured PAT's permissions; Leilei OS does not silently synchronize Notion into canonical application domains.
- Database migrations, imports, and other durable writes require explicit release/operation ownership; no production mutation is hidden in a read path.
