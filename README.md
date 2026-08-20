# Leilei OS

Leilei OS is an authenticated personal workspace: a React Web app, a
PostgreSQL-backed API, and an OAuth-protected Streamable HTTP MCP server. The
single integration, development, and release trunk is `main`; see
[`docs/branch-release-policy.md`](docs/branch-release-policy.md) for the branch
and release rules.

## Current product status

The current codebase contains the following working areas:

- **Memory, Diary, and Task** — PostgreSQL-backed personal records with
  filtering, search, editing, lifecycle actions, and server-side ownership.
- **Dashboard and Day Space** — authenticated home and date-scoped Todo/Diary
  views backed by the real APIs.
- **Todo** — durable daily papers, revisions, status-aware entries, and
  legacy-data migration support.
- **Universe** — spatial Universe nodes, weighted galaxy memberships,
  relations, revisions, backups, import/export, Global Search integration, and
  explicit MCP node/relation writes.
- **Global Search** — authenticated cross-module search for Memory, Diary, Task,
  and Universe with cursor pagination and deep links.
- **System** — account, connections, activity, data export/import, and about
  pages.
- **Notion integration** — server-side read access plus explicit, verified
  page/comment writes through the MCP surface.
- **PWA runtime** — Vite PWA manifest/assets, service-worker registration,
  prompt-based updates, and online/update status UI. The backend remains the
  source of truth for persisted application data.

The current database migration head is
`0025_wild_xavin` (see `drizzle/meta/_journal.json`). The migration chain
must be reviewed before any production database change.

## Web application

The Web app is protected by Auth0 and includes Dashboard, Day Space, Memory,
Diary, Task, Todo, Universe, Global Search, and System routes. It reads and
writes through the authenticated `/api/v1` service; it is no longer a static
page-shell-only foundation.

## MCP and Notion capabilities

The public MCP endpoint uses Auth0 and Streamable HTTP. The registered tools
cover:

- local context, weather, Memory, Diary, Task, Todo, Toy, and Global Search;
- Universe search, node/relation reads, node create/update, and relation create;
- Notion connection discovery, page/database/data-source reads, and safe
  parameterized data-source queries;
- explicit `write_notion_page` and `write_notion_comment` operations, each
  using fresh-read and readback verification. Destructive Notion delete/archive
  operations are not exposed.

MCP and Web clients never select a database user ID. Authenticated ownership is
resolved server-side, and Notion credentials remain in server environment
configuration only.

## HTTP API surfaces

In addition to `/health`, `/mcp`, and optional `/internal/mcp`, the authenticated
Web API exposes `/api/v1` routes for:

`/memory`, `/diary`, `/task`, `/toy`, `/system`, `/todo`, `/search`,
`/system/export`, `/system/import`, and `/universe`.

## Architecture

```text
Web / MCP
    ↓
Service
    ↓
Repository
    ↓
PostgreSQL
```

The Web API and MCP tools share domain services and repositories. Authentication
establishes the server-owned user identity before domain code accesses data.

## Local requirements

- Node.js 20 or newer
- pnpm 11.9.0 for the root service
- npm for the Web package
- PostgreSQL for persistent features and migrations

Copy the environment templates and provide development values through ignored
local files:

```bash
cp .env.example .env
cp web/.env.example web/.env.local
pnpm install
npm --prefix web install
```

The root template documents the PostgreSQL, MCP OAuth, Web API OAuth, CORS, and
optional internal MCP variables. The Web template documents:

- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`
- `VITE_AUTH0_SCOPE`
- `VITE_AUTH0_REDIRECT_URI`
- `VITE_API_BASE_URL`

The API listens on `http://localhost:3000` by default. Vite serves the Web app
on `http://localhost:5173` by default. Useful backend routes are:

- `GET /health`
- `/mcp` — public OAuth-protected MCP endpoint
- `/internal/mcp` — optional internal bearer-token endpoint
- `/api/v1` — Auth0-protected Web API

## Root development

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm start
```

`pnpm start` runs the compiled server from `dist/app/index.js`; run
`pnpm build` first.

## Web development

```bash
npm --prefix web run dev
npm --prefix web run typecheck
npm --prefix web run build
```

## Database migrations

Set `DATABASE_URL` for the intended PostgreSQL database, review pending
migrations, and run:

```bash
pnpm db:migrate
```

Migrations are defined by the Drizzle schema in `src/database/schema.ts` and
versioned under `drizzle/`. Never point a local migration command at production
without an approved backup and deployment procedure.

## Production deployment

Railway builds the API from the root multi-stage `Dockerfile` and runs the
compiled Node.js service on the platform-provided `PORT` (default `3000`). The
deployed service exposes the HTTPS health, MCP, and Web API routes.

The `web/` React SPA is built separately. Its Vercel configuration runs
`npm run build`, serves `web/dist`, and rewrites application routes to
`index.html`.

Production credentials and database URLs belong in the deployment platforms'
secret/environment-variable stores, never in source control.

## Security and data boundaries

- Public MCP access uses Auth0 JWT issuer, audience, scope, and allowed-subject
  checks.
- Web access uses its own Auth0 audience and scope plus an explicit allowed
  origin.
- Authenticated subjects map server-side to `MCP_USER_ID`; clients do not
  choose database user IDs.
- Repositories scope personal records by user, status, and visibility as
  required by each domain.
- `DATABASE_URL`, OAuth credentials, internal MCP tokens, and bridge keys are
  server-side secrets and must not be logged or committed.
- The optional `/internal/mcp` route is enabled only when
  `MCP_AUTH_TOKEN` is configured.
