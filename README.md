# Leilei OS

Leilei OS is a personal assistant service that gives an authenticated Web app
and ChatGPT MCP access to persistent personal data. The original Phase 1
connectivity probe is historical; the repository now contains the working
Memory, Diary, and Task product.

## Current product status

The current implementation includes:

- a React Web UI protected by Auth0;
- PostgreSQL-backed Memory, Diary, Task, Settings, and Dashboard data;
- an OAuth-protected remote MCP endpoint using Streamable HTTP;
- MCP read capabilities including `read_memory`, local-time context, and
  weather context;
- MCP writes for creating diary entries and tasks.

Chat Archive and Universe remain visible placeholders in the Web information
architecture. They are not implemented product modules.

## Implemented modules

- **Memory** — create, read, edit, archive, search, category and tag filters,
  detail views, and read-only creation-source display.
- **Diary** — create, read, edit, search, tag, mood, and date filters.
- **Task** — create, read, edit, search, filtering, controlled status
  transitions, optional due times, and account-timezone handling.
- **Web** — authenticated Dashboard, Memory, Diary, Task, and Settings pages.
- **MCP** — authenticated tools for reading Memory and context, plus the
  implemented Diary and Task creation tools.

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
