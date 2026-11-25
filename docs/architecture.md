# Leilei OS Architecture

## Current system

Leilei OS is an authenticated personal workspace composed of:

- a native iOS app (`ios/`), the everyday client, and a React Web application, both using the authenticated Web API;
- a PostgreSQL-backed Express API with domain services and repositories;
- an OAuth-protected Streamable HTTP MCP server;
- one MCP Apps UI resource, the Note Card;
- a PWA runtime for the Web application; and
- a Native Live / Runtime backend where Railway owns durable authority and a Mac Companion process performs local Claude execution and bounded background work.

Mind (memory) is described in [mind.md](mind.md).

ChatGPT is one MCP client. Leilei OS does not call the OpenAI API. Native Live conversations are canonical here; the older conversation-import tables remain in the schema, but no code outside it reads or writes them.

## Runtime boundaries

```text
iOS / Web / MCP client / MCP Apps host
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

## Architecture decision rules

- **Domain contracts define business semantics; PostgreSQL stores canonical durable state.** UI or MCP transport details must not become a second source of truth.
- **MCP tools are the capability layer.** Reads, discovery, mutations, concurrency and lifecycle rules remain domain-owned; tool schemas make safe stable defaults explicit instead of repeatedly asking the model to choose meaningless state.
- **iOS is the everyday product surface; Web shares the same API and domains.** MCP Apps are optional host-specific enhancements, not a default product layer. Add one only when a concrete host-embedded interaction is materially better than ordinary MCP tools plus the apps.
- **Dedicated discovery and detail stay domain-specific.** When the domain is known, use that domain's browse/search tool and then its exact detail pointer. A domain may combine browse and search in one tool when that matches its semantics; tools are not split merely for naming symmetry.
- **Global Search is cross-domain discovery.** Use it when the target domain is unknown or the query genuinely spans domains; it must return compact records and exact detail pointers rather than absorb domain-specific detail or mutation behavior.
- **Modules keep their own semantics.** Diary, Todo, Universe, Native Live, and Runtime/Mind do not inherit another module's revision, lifecycle, concurrency, or UI model just to look architecturally uniform.
- **Operational probes do not consume model-visible inventory when an existing transport-level health/handshake check is sufficient.** Keep the public tool surface focused on capabilities that help accomplish user work.
- Product order, abstractions and UI shape are chosen from current value and dependencies, not from a requirement to make every module structurally identical.

## OAuth authorization boundary

The public `/mcp` path verifies configured OAuth issuer, audience, scope, signature, and allowed subject before a session reaches domain tools.

An optional Auth0-backed local authorization adapter can be enabled with `OAUTH_AS_ENABLED=true`. It keeps Auth0 as the identity and token issuer, resolves configured static clients first, and can resolve only explicitly trusted CIMD client-metadata URLs over the repository's bounded HTTPS fetch path. Authorization codes are short-lived, single-use, and bound to the exact client, redirect URI, scope, resource, audience, and PKCE S256 challenge.

The adapter is configuration-dependent; repository support for it does not by itself prove that it is enabled in a particular live environment. Production state must be verified from deployment configuration rather than inferred from this document.

## Web application

The Web application contains authenticated Dashboard and Day Space views plus Diary, Mind, Universe, Global Search, and Settings routes. Todo papers are edited from the Dashboard and Day Space. Chat exists only on iOS. Durable data is read and written through `/api/v1`; the server remains authoritative.

The PWA build emits the manifest and service worker from `web/`. Vercel serves the built SPA from `web/dist` with history fallback. The production branch is `main`.

## MCP surface

The authenticated production MCP router registers the current LeileiOS tool surface, including personal workspace reads/writes, Global Search and Universe operations, Toy operations when configured, the Note Card resource, and, only when a tool profile enables them, Notion reads/writes. Profiles live in `src/mcp/server/tool-profiles.ts`; a Native Live SDK session sees fewer tools still (`tools/claude-bridge/src/agent-sdk-disallowed-tools.mjs`), which does not change the server.

Notion tools use server-side authorization. `read_notion_page` exposes a plain schema with optional `page_id` and `page_url` fields and enforces exactly one reference inside the handler, returning `INVALID_PAGE_REFERENCE` for missing or ambiguous references. Explicit Notion page/comment writes use fresh-read and readback verification. Destructive Notion delete/archive operations are not exposed.

MCP schemas are Zod-validated. Safe error mappings distinguish invalid input, missing resources, authorization failures, conflicts, unavailable providers, and service failures without exposing credentials, connection strings, SQL, or stack traces.

### Note Card

`render_note_card` displays supplied user-visible text as an MCP Apps card and persists nothing. Resource URIs and the rename history are in the [README](../README.md#mcp-apps).

## MCP session lifecycle

Streamable HTTP sessions are process-local and namespaced: `/mcp` uses the public namespace and `/internal/mcp` uses the internal namespace. Session governance and idempotency retention are enforced by the server implementation; they are not cross-replica distributed locks.

## Database and migrations

PostgreSQL holds durable user, Diary, Todo, Universe, historical conversation imports, Native Live/Runtime, audit, integration, and related application state. Historical migrations for retired product surfaces remain in the migration chain because migration history is append-only.

The canonical checked-in migration source is `drizzle/meta/_journal.json`; read its final entry when the current migration head is needed instead of copying a head value into this document.

Railway runs `node dist/database/migrate.js` as the configured pre-deploy command. The runner performs readiness checks, uses the LeileiOS-owned `public.leilei_schema_migrations` ledger, cross-checks the legacy Drizzle ledger when bootstrapping, and applies pending checked-in migrations transactionally.

Normal application startup does not run migrations. Manual local or disposable-database checks must never be pointed at production without an approved backup and release procedure.

## Deployment topology

- GitHub default branch and release trunk: `main`.
- Railway Production source: `main`; the root `Dockerfile` builds the API/MCP service and `scripts/build-mcp-browser.mjs` produces the Note Card runtime.
- `.railway/railway.ts` (Railway Infrastructure as Code) configures the Dockerfile builds, the compiled migration runner as pre-deploy work and the readiness healthcheck.
- Vercel Production Branch: `main`; Vercel builds `web/` and serves the SPA.
- Production credentials and database URLs stay in platform secret stores.

Repository architecture describes code/configuration on `main`. It must not be used as evidence that a particular commit has already reached production; verify deployment SHA and health separately.

## Security constraints

- OAuth issuer, audience, signature, scope, subject, and Web origin checks are enforced server-side.
- Authenticated ownership is applied in domain services and repositories.
- `DATABASE_URL`, OAuth credentials, MCP tokens, bridge keys, and `NOTION_PAT` are server-only and must never be logged, returned, or committed.
- Notion access is limited by the configured PAT's permissions; Leilei OS does not silently synchronize Notion into canonical application domains.
- Database migrations, imports, and other durable writes require explicit release/operation ownership; no production mutation is hidden in a read path.
