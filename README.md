# Leilei OS

Leilei OS is an authenticated personal workspace built around a native iOS app, a React Web app, a PostgreSQL-backed API, an OAuth-protected Streamable HTTP MCP server, and a Mac daemon that runs Claude locally. The single integration and release trunk is `main`; see [`docs/branch-release-policy.md`](docs/branch-release-policy.md) for the repository workflow.

## Current product surface

The current codebase includes:

- **Diary and Todo** — durable personal records with server-side ownership, bounded reads/search, canonical Diary comments, and revision-aware Todo entry writes.
- **Native Live / Runtime** — canonical native conversations plus Railway-owned durable authority, Mac Companion execution, bounded Runtime/Mind state, and event-driven relay/control contracts.
- **Dashboard and Day Space** — authenticated date-scoped views backed by the real API.
- **Mind** — memories recalled into Claude conversations, written through explicit MCP tools or by hand.
- **Universe** — nodes, weighted galaxy memberships, relations, revisions, provenance, backup/import/export, search, and explicit MCP writes.
- **Global Search** — authenticated search across Diary, Todo, Universe and Memory, with deep links.
- **Settings** — Account, Status, Data (Summary / Export / Restore), and About surfaces.
- **Health v2** — owner-scoped daily summaries with optional iPhone Shortcut sync and MCP reads.
- **Notion integration** — optional MCP tools, off in the default public tool profile.
- **PWA Web runtime** — Vite PWA assets, service-worker registration, update prompts, and online/update status UI.
- **MCP Apps surface** — a user-visible Note Card (`render_note_card`).

The checked-in database migration chain is authoritative in [`drizzle/meta/_journal.json`](drizzle/meta/_journal.json). Read the final journal entry instead of duplicating a migration-head value in documentation, and review the chain before any production database change.

## Web, API, and MCP architecture

```text
Web / MCP client
      │ authenticated request
      ▼
Express Web API / MCP router
      │ server-owned identity
      ▼
Domain services
      │ validation, ownership, lifecycle, concurrency
      ▼
Repositories ─────────────► PostgreSQL
      │
      └───────────────────► Notion API
```

The Web API and MCP tools share domain services and repositories. Authenticated clients do not select a database user ID; ownership is resolved server-side before domain code accesses persisted data.

The public MCP endpoint is `/mcp`. An optional `/internal/mcp` path is available only when its internal bearer-token configuration is present. The authenticated Web API is served under `/api/v1`.

## MCP Apps

`render_note_card` displays supplied user-visible text in a card. It does not expose hidden reasoning and stores nothing. The standard resource is `ui://widget/leileios-note-card-v2.html`; ChatGPT's `openai/outputTemplate` pointer uses `ui://widget/leileios-note-card-chatgpt-v2.html`, and both serve the same HTML. Change the URI for a material UI change, because hosts cache resources by URI. Its files still live in `src/mcp/tools/render-thinking-block/`, the name of the tool it replaced.

## Notion MCP surface

Notion tools are registered only when a tool profile includes them (`src/mcp/server/tool-profiles.ts`; `MCP_PUBLIC_TOOL_PROFILES` / `MCP_INTERNAL_TOOL_PROFILES`). They use server-side authorization and do not expose the configured PAT to clients. `read_notion_page` accepts exactly one of `page_id` or `page_url`; invalid or ambiguous references return a structured `INVALID_PAGE_REFERENCE` error. Explicit page/comment writes use fresh-read and readback verification. Destructive Notion delete/archive operations are not exposed.

## Local development

Requirements:

- Node.js 24 (`.node-version`, CI and the server image; `web/` requires it)
- pnpm 11.9.0 for the root service
- npm for the Web package
- PostgreSQL for persistent features and migration checks

Setup:

```bash
cp .env.example .env
cp web/.env.example web/.env.local
pnpm install
npm --prefix web install
```

Root commands:

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm start
pnpm db:check
```

Web commands:

```bash
npm --prefix web run dev
npm --prefix web run typecheck
npm --prefix web run build
```

`pnpm build` compiles the service and regenerates the Note Card browser bundle. `pnpm start` runs `dist/app/index.js`; build first.

## Deployment topology

- **GitHub:** `main` is the canonical integration and release trunk.
- **Railway:** the API/MCP service is built from the root `Dockerfile`; `.railway/railway.ts` (Railway IaC) runs `node dist/database/migrate.js` as the pre-deploy migration step, then the container starts `node dist/app/index.js`.
- **Vercel:** the `web/` SPA is built separately from `main` and served from `web/dist` with SPA route rewrites.

Repository documentation describes the checked-in release path, not the live deployment SHA. Verify the platform-reported commit and `/health` during production acceptance.

## Security boundaries

- Public MCP access validates OAuth issuer, audience, signature, scope, and allowed subject server-side.
- The optional local authorization adapter preserves Auth0 as the identity/token issuer and restricts dynamic client metadata resolution to configured HTTPS clients.
- Web access uses its own Auth0 audience/scope and an explicit allowed origin.
- `DATABASE_URL`, OAuth credentials, MCP tokens, bridge keys, and `NOTION_PAT` are server-side secrets and must not be logged or committed.
- Database migrations, imports, and other durable production writes require explicit operational ownership.

## Authoritative documentation

- [`docs/architecture.md`](docs/architecture.md) — current system boundaries and runtime architecture.
- [`docs/deployment.md`](docs/deployment.md) — current release and production verification path.
- [`docs/branch-release-policy.md`](docs/branch-release-policy.md) — branch and release rules.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — recurring build/deployment diagnostics.
- [`docs/claude-code-mind.md`](docs/claude-code-mind.md) — **current** Mind Hook install, pause/resume and acceptance guide.
- [`docs/native-session/catalog.md`](docs/native-session/catalog.md) — **current** manual Desktop ↔ LeileiOS switching steps and safety gates.
- [`docs/mind-memory-api.md`](docs/mind-memory-api.md) — Memory API and iOS/Web date filtering.

Dated implementation plans and design specs in the [historical engineering index](docs/archive/README.md) are **not current operating instructions**. Old superseded versions of the Mind Hook and session-switch guides remain available at fixed Git commits linked from those guides; the current procedure belongs in the authoritative documents above.
