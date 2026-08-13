# Notion Global Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add whole-workspace Notion read access to Leilei OS through `search_notion` and `read_notion_page`, backed by a server-only Personal Access Token.

**Architecture:** Add a small fetch-based Notion read client in `src/domains/notion`, then wrap it with two read-only MCP tools and register them in the existing MCP server. Keep the PAT optional at boot but fail safely when a Notion tool is invoked without configuration. No database or Web changes are required.

**Tech Stack:** TypeScript, Node 20+ built-in `fetch`, Zod, `@modelcontextprotocol/sdk`, Node test runner.

## Global Constraints

- Use Notion API version `2026-03-11`.
- Use only a server-side `NOTION_PAT`; never accept it in MCP input or return/log it.
- First version is read-only: no create/update/archive/delete/comment tools.
- `search_notion` searches accessible pages by title only.
- `read_notion_page` does not recursively expand child pages or child databases.
- Maximum traversal depth is 8, maximum blocks is 500, maximum rendered text is 60,000 characters.
- Both Notion tools require existing Leilei OS MCP authentication.
- Both tools use annotations `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }`.
- No database migration.

---

### Task 1: Notion read client

**Files:**
- Create: `src/domains/notion/notion-read-client.ts`
- Test: `tests/notion-read-client.test.ts`

**Interfaces:**
- Produces: `NotionReadClient`, `NotionReadError`, `NotionSearchInput`, `NotionSearchResult`, `NotionPageReadResult`.
- `NotionReadClient.searchPages(input)` returns bounded page-title search results and pagination metadata.
- `NotionReadClient.readPage(pageId)` returns page metadata, rendered text, block count, and truncation state.

- [ ] **Step 1: Write failing client tests**

Cover:

```ts
await client.searchPages({ query: "main", limit: 10 });
```

Assert `POST https://api.notion.com/v1/search`, Bearer auth, `Notion-Version: 2026-03-11`, page-only filter, title extraction, and pagination mapping.

Cover:

```ts
await client.readPage("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
```

Assert page metadata fetch, block pagination, nested structural-block traversal, readable block rendering, no recursive expansion of `child_page`, and safe 401/403/404/429 error mapping.

- [ ] **Step 2: Run focused client test and verify RED**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-read-client.test.ts
```

Expected: FAIL because the client module does not exist yet.

- [ ] **Step 3: Implement minimal Notion read client**

Implement:

```ts
export class NotionReadClient {
  constructor(token: string | undefined, fetchImpl: typeof fetch = fetch) {}
  async searchPages(input: NotionSearchInput): Promise<NotionSearchResult> {}
  async readPage(pageId: string): Promise<NotionPageReadResult> {}
}
```

Use fixed constants:

```ts
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2026-03-11";
const MAX_DEPTH = 8;
const MAX_BLOCKS = 500;
const MAX_TEXT_LENGTH = 60_000;
```

Normalize page titles from the page property whose `type` is `title`. Traverse block children only when `has_children` is true and block type is not `child_page` or `child_database`. Paginate with `page_size=100` and `start_cursor` until complete or a bound is reached.

- [ ] **Step 4: Run focused client test and verify GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 5: Commit client and tests**

```bash
git add src/domains/notion/notion-read-client.ts tests/notion-read-client.test.ts
git commit -m "feat: add Notion read client"
```

### Task 2: MCP Notion tools

**Files:**
- Create: `src/mcp/tools/search-notion/register.ts`
- Create: `src/mcp/tools/read-notion-page/register.ts`
- Test: `tests/notion-mcp-tools.test.ts`

**Interfaces:**
- Consumes: `NotionReadClient`-compatible service methods from Task 1.
- Produces: `SearchNotionToolDependencies`, `ReadNotionPageToolDependencies`, `registerSearchNotionTool`, `registerReadNotionPageTool`.

- [ ] **Step 1: Write failing MCP tool tests**

Use `McpServer`, `Client`, and `InMemoryTransport` to assert:

```ts
search_notion({ query: "main" })
read_notion_page({ page_id: PAGE_ID })
```

Verify strict schemas reject `user_id`, results are structured, authenticated user resolution is called, service inputs do not contain user-controlled identity/token values, annotations use `openWorldHint: true`, and mapped service errors return safe text without upstream bodies.

- [ ] **Step 2: Run focused MCP tool test and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-mcp-tools.test.ts
```

Expected: FAIL because the tool modules do not exist.

- [ ] **Step 3: Implement `search_notion`**

Strict input schema:

```ts
{
  query: string, // trimmed NFC, 1-200 Unicode code points
  limit?: number, // 1-25
  cursor?: string // bounded length
}
```

Return `success: true` with page results and pagination metadata. Call `getAuthenticatedUserId()` before the service call. Map Notion read errors to safe MCP messages.

- [ ] **Step 4: Implement `read_notion_page`**

Strict input schema:

```ts
{ page_id: string }
```

Accept a Notion page UUID in hyphenated or compact hexadecimal form. Return page metadata plus `content`, `block_count`, and `truncated`. Call `getAuthenticatedUserId()` before the service call.

- [ ] **Step 5: Run focused MCP tool test and verify GREEN**

Run the same focused command. Expected: PASS.

- [ ] **Step 6: Commit MCP tool modules and tests**

```bash
git add src/mcp/tools/search-notion/register.ts src/mcp/tools/read-notion-page/register.ts tests/notion-mcp-tools.test.ts
git commit -m "feat: add Notion MCP read tools"
```

### Task 3: Production wiring and secret configuration contract

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `src/mcp/server/create-server.ts`
- Test: `tests/mcp-read-contract.test.ts`

**Interfaces:**
- Consumes: Notion client and tool registration from Tasks 1-2.
- Produces: production `NotionReadClient(env.NOTION_PAT)` dependency wiring and test-injectable `notionTools` dependencies.

- [ ] **Step 1: Extend MCP read-contract test first**

Add injected Notion read dependencies to the existing in-memory fixture. Assert `search_notion` and `read_notion_page` remain registered with read-only/open-world annotations and reject client-supplied identity.

- [ ] **Step 2: Run the read-contract test and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/mcp-read-contract.test.ts
```

Expected: FAIL because `createMcpServer` does not yet expose/register the Notion tools.

- [ ] **Step 3: Add environment contract**

Add:

```ts
NOTION_PAT: z.string().trim().min(16).optional(),
```

Document `NOTION_PAT` in `.env.example` as a server-only Personal Access Token with Read content capability only.

- [ ] **Step 4: Wire Notion tools into `createMcpServer`**

Create one lazy default `NotionReadClient` and register both tools. Add a combined optional dependency:

```ts
notionTools?: {
  notionService: SearchNotionToolDependencies["notionService"] &
    ReadNotionPageToolDependencies["notionService"];
  getAuthenticatedUserId: () => string;
};
```

Production tool calls use the existing authenticated MCP user ID only as an authorization gate; the Notion PAT remains server-side.

- [ ] **Step 5: Run focused Notion/read-contract tests**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-read-client.test.ts tests/notion-mcp-tools.test.ts tests/mcp-read-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit wiring**

```bash
git add src/config/env.ts .env.example src/mcp/server/create-server.ts tests/mcp-read-contract.test.ts
git commit -m "feat: wire Notion reads into MCP"
```

### Task 4: Verification and production gate

**Files:**
- No product-code changes expected.

- [ ] **Step 1: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Review branch diff**

Compare the feature branch against `codex/phase-6-web-ui-foundation`. Expected: only the design/plan docs, Notion client/tools/tests, env docs, and MCP wiring changed; no migration/Web/PWA files.

- [ ] **Step 3: Configure production secret before live smoke**

Create a Notion PAT with Notion API `Read content` capability and add it to Railway as `NOTION_PAT`. Do not paste the token into chat, GitHub, Notion pages, logs, or test fixtures.

- [ ] **Step 4: Deploy and live-smoke**

After the production branch advances and Railway deploys successfully, verify through authenticated MCP:

```text
search_notion query="主线规划"
read_notion_page page_id=<returned page id>
```

Expected: search returns the accessible page and read returns real page content. Also confirm no Notion write tool is registered.
