# Notion Global Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend LeileiOS Notion integration from global read-only access to the complete resource-oriented write surface supported by Notion API `2026-03-11`, with no LeileiOS-side confirmation gate.

**Architecture:** Keep the existing `search_notion` and `read_notion_page` contracts, but move their HTTP/auth/error behavior onto a shared Notion transport. Add focused mutation clients for pages/blocks, databases/data sources/views, comments, and file uploads, then expose seven explicit MCP mutation tools that only target known Notion endpoint templates.

**Tech Stack:** TypeScript, Node 24 CI, Zod, `@modelcontextprotocol/sdk`, native `fetch`/`FormData`, Notion REST API `2026-03-11`, `node:test` via `tsx`.

## Global Constraints

- `NOTION_PAT` remains server-only; it must never be returned, logged, committed, embedded in browser code, or accepted as a tool argument.
- No page allowlist and no second `confirm=true` destructive-operation gate.
- Only known relative Notion API endpoint templates may be used; no arbitrary absolute URL passthrough tool.
- Existing `search_notion` and `read_notion_page` behavior remains available.
- Do not automatically retry non-idempotent Notion writes.
- Normalize `NOT_CONFIGURED`, `ACCESS_DENIED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `VALIDATION`, and `UPSTREAM`.
- No database migration and no PWA/Web product behavior change.

---

### Task 1: Shared Notion transport and read-client refactor

**Files:**
- Create: `src/domains/notion/notion-transport.ts`
- Modify: `src/domains/notion/notion-read-client.ts`
- Create: `tests/notion-transport.test.ts`
- Modify: `tests/notion-read-client.test.ts`

**Interfaces:**
- Produces: `NotionTransport`, `NotionApiError`, `NotionApiErrorCode`, and `requestJson(path, init)` for later mutation clients.
- Preserves: `NotionReadClient.searchPages()` and `NotionReadClient.readPage()` public signatures.

- [ ] **Step 1: Write failing transport tests**

Test exact `Authorization`, `Notion-Version: 2026-03-11`, `Content-Type`, relative-path enforcement, status mapping for 400/401/403/404/409/429/5xx/network failures, and verify error messages never contain the PAT.

```ts
const transport = new NotionTransport("ntn_test_secret_123456", fetchMock);
await transport.requestJson("/pages/page-id", { method: "PATCH", body: JSON.stringify({ in_trash: true }) });
assert.equal(captured.headers.get("Authorization"), "Bearer ntn_test_secret_123456");
assert.equal(captured.headers.get("Notion-Version"), "2026-03-11");
await assert.rejects(() => transport.requestJson("https://evil.example/x"), /relative Notion API path/i);
```

- [ ] **Step 2: Run transport/read tests and verify RED**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-transport.test.ts tests/notion-read-client.test.ts
```

Expected: FAIL because `notion-transport.ts` and its API do not exist yet.

- [ ] **Step 3: Implement shared transport**

Implement:

```ts
export type NotionApiErrorCode =
  | "NOT_CONFIGURED" | "ACCESS_DENIED" | "NOT_FOUND" | "CONFLICT"
  | "RATE_LIMITED" | "VALIDATION" | "UPSTREAM";

export class NotionApiError extends Error {
  constructor(public readonly code: NotionApiErrorCode, message: string) { super(message); }
}

export class NotionTransport {
  constructor(private readonly token: string | undefined, private readonly fetchImpl: typeof fetch = fetch) {}
  requestJson(path: string, init?: RequestInit): Promise<Record<string, unknown>>;
  requestRaw(path: string, init?: RequestInit): Promise<Response>;
}
```

Reject paths not starting with `/` or containing an absolute URL scheme. Map 400→`VALIDATION`, 401/403→`ACCESS_DENIED`, 404→`NOT_FOUND`, 409→`CONFLICT`, 429→`RATE_LIMITED`, network/5xx/invalid JSON→`UPSTREAM`.

- [ ] **Step 4: Refactor `NotionReadClient` onto `NotionTransport`**

Constructor becomes compatible with existing callers:

```ts
constructor(token: string | undefined, fetchImpl: typeof fetch = fetch) {
  this.transport = new NotionTransport(token, fetchImpl);
}
```

Replace the private request implementation with `transport.requestJson(...)` and preserve the old `NotionReadError` outward behavior by mapping `NotionApiError` codes.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-transport.test.ts tests/notion-read-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domains/notion/notion-transport.ts src/domains/notion/notion-read-client.ts tests/notion-transport.test.ts tests/notion-read-client.test.ts
git commit -m "refactor: share Notion transport"
```

### Task 2: Page and block mutation client

**Files:**
- Create: `src/domains/notion/notion-page-block-client.ts`
- Create: `tests/notion-page-block-client.test.ts`

**Interfaces:**
- Consumes: `NotionTransport.requestJson`.
- Produces:

```ts
createPage(body: JsonObject): Promise<JsonObject>                 // POST /pages
updatePage(pageId: string, body: JsonObject): Promise<JsonObject> // PATCH /pages/{id}
movePage(pageId: string, parent: JsonObject): Promise<JsonObject> // POST /pages/{id}/move
updatePageMarkdown(pageId: string, body: JsonObject): Promise<JsonObject> // PATCH /pages/{id}/markdown
appendBlockChildren(blockId: string, body: JsonObject): Promise<JsonObject> // PATCH /blocks/{id}/children
updateBlock(blockId: string, body: JsonObject): Promise<JsonObject> // PATCH /blocks/{id}
deleteBlock(blockId: string): Promise<JsonObject>                 // DELETE /blocks/{id}
```

- [ ] **Step 1: Write failing page/block request-shape tests**

Cover create/update/move/trash/restore page behavior (`in_trash` true/false), content mutation through the markdown endpoint, append/insert children using Notion-supported child-position body fields, block update, DELETE block, and restore via `PATCH /blocks/{id}` with `in_trash:false`.

- [ ] **Step 2: Run page/block client tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-page-block-client.test.ts
```

- [ ] **Step 3: Implement minimal client methods**

All IDs are URL-encoded into fixed endpoint templates; bodies pass through as JSON objects without accepting any caller-supplied endpoint URL.

- [ ] **Step 4: Run page/block client tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-page-block-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domains/notion/notion-page-block-client.ts tests/notion-page-block-client.test.ts
git commit -m "feat: add Notion page and block mutations"
```

### Task 3: Database, data-source, and view mutation client

**Files:**
- Create: `src/domains/notion/notion-structure-client.ts`
- Create: `tests/notion-structure-client.test.ts`

**Interfaces:**
- Consumes: `NotionTransport.requestJson`.
- Produces:

```ts
createDatabase(body: JsonObject): Promise<JsonObject>                  // POST /databases
updateDatabase(databaseId: string, body: JsonObject): Promise<JsonObject> // PATCH /databases/{id}
createDataSource(body: JsonObject): Promise<JsonObject>                // POST /data_sources
updateDataSource(dataSourceId: string, body: JsonObject): Promise<JsonObject> // PATCH /data_sources/{id}
createView(body: JsonObject): Promise<JsonObject>                      // POST /views
updateView(viewId: string, body: JsonObject): Promise<JsonObject>      // PATCH /views/{id}
```

- [ ] **Step 1: Write failing structure request-shape tests**

Verify fixed paths/methods and support `properties: {name: null}` removal, `in_trash` restore/trash, parent moves, database metadata changes, and view filter/sort/configuration updates.

- [ ] **Step 2: Run structure tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-structure-client.test.ts
```

- [ ] **Step 3: Implement minimal structure client**

Do not interpret Notion property schemas locally; preserve official JSON property/data-source/view payload shapes and let Notion validate unsupported combinations.

- [ ] **Step 4: Run structure tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-structure-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domains/notion/notion-structure-client.ts tests/notion-structure-client.test.ts
git commit -m "feat: add Notion structure mutations"
```

### Task 4: Comment and file-upload mutation clients

**Files:**
- Create: `src/domains/notion/notion-comment-client.ts`
- Create: `src/domains/notion/notion-file-upload-client.ts`
- Create: `tests/notion-comment-client.test.ts`
- Create: `tests/notion-file-upload-client.test.ts`

**Interfaces:**
- Comment:

```ts
createComment(body: JsonObject): Promise<JsonObject> // POST /comments
updateComment(commentId: string, body: JsonObject): Promise<JsonObject> // PATCH /comments/{id}
```

- File upload:

```ts
createUpload(body: JsonObject): Promise<JsonObject> // POST /file_uploads
sendUpload(fileUploadId: string, file: Blob, filename: string, partNumber?: number): Promise<JsonObject> // POST /file_uploads/{id}/send
completeUpload(fileUploadId: string): Promise<JsonObject> // POST /file_uploads/{id}/complete
```

- [ ] **Step 1: Write failing comment/upload tests**

Verify comment create/reply/update paths, update does not imply it can edit another actor's comment, single- and multipart `FormData` fields, and PAT omission from errors.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-comment-client.test.ts tests/notion-file-upload-client.test.ts
```

- [ ] **Step 3: Implement comment and upload clients**

For multipart requests, use `requestRaw` so `Content-Type` is set by `FormData` rather than forcing JSON. Parse the JSON response through the same safe error mapping.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-comment-client.test.ts tests/notion-file-upload-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/domains/notion/notion-comment-client.ts src/domains/notion/notion-file-upload-client.ts tests/notion-comment-client.test.ts tests/notion-file-upload-client.test.ts
git commit -m "feat: add Notion comment and file mutations"
```

### Task 5: Seven authenticated MCP write tools

**Files:**
- Create: `src/mcp/tools/write-notion-page/register.ts`
- Create: `src/mcp/tools/write-notion-block/register.ts`
- Create: `src/mcp/tools/write-notion-database/register.ts`
- Create: `src/mcp/tools/write-notion-data-source/register.ts`
- Create: `src/mcp/tools/write-notion-view/register.ts`
- Create: `src/mcp/tools/write-notion-comment/register.ts`
- Create: `src/mcp/tools/upload-notion-file/register.ts`
- Create: `src/mcp/tools/notion-write-shared.ts`
- Create: `tests/notion-write-mcp-tools.test.ts`

**Interfaces:**
- Produces MCP tools: `write_notion_page`, `write_notion_block`, `write_notion_database`, `write_notion_data_source`, `write_notion_view`, `write_notion_comment`, `upload_notion_file`.
- Each output uses `{ success: true, data: <Notion object> }` and safe textual errors.

- [ ] **Step 1: Write failing MCP contract tests**

Verify all tool names and annotations, authenticated-user check occurs before any Notion mutation, destructive actions contain no synthetic confirmation field, absolute URL fields are not part of schemas, and action-specific required IDs/bodies are enforced.

- [ ] **Step 2: Run MCP tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-write-mcp-tools.test.ts
```

- [ ] **Step 3: Implement shared write schema/error utilities**

Use a bounded recursive JSON schema for Notion bodies:

```ts
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string().max(100_000), z.number(), z.boolean(), z.null(),
  z.array(jsonValue).max(1000), z.record(z.string().max(200), jsonValue),
]));
```

Tool inputs accept resource IDs and official request-body fragments, not endpoint URLs or PAT values.

- [ ] **Step 4: Implement page/block tools**

`write_notion_page` actions: `create`, `update`, `move`, `update_content`, `trash`, `restore`.

`write_notion_block` actions: `append_children`, `insert_children`, `update`, `delete`, `restore`.

- [ ] **Step 5: Implement structure tools**

`write_notion_database`: `create`, `update`.

`write_notion_data_source`: `create`, `update`, `trash`, `restore`.

`write_notion_view`: `create`, `update`.

- [ ] **Step 6: Implement comment and file tools**

`write_notion_comment`: `create`, `reply`, `update`.

`upload_notion_file`: `create`, `send`, `complete`; `send` accepts a bounded base64 payload for the MCP JSON transport, decodes it server-side to `Blob`, and never accepts local filesystem paths or URLs as implicit upload sources.

- [ ] **Step 7: Run MCP tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-write-mcp-tools.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/mcp/tools/write-notion-* src/mcp/tools/upload-notion-file src/mcp/tools/notion-write-shared.ts tests/notion-write-mcp-tools.test.ts
git commit -m "feat: expose Notion write MCP tools"
```

### Task 6: Production wiring and regression contracts

**Files:**
- Modify: `src/mcp/server/create-server.ts`
- Create: `tests/notion-write-server-wiring.test.ts`
- Modify: `tests/notion-server-wiring.test.ts`
- Modify: `.env.example` only if documentation needs clarification; no new secret beyond `NOTION_PAT`.

**Interfaces:**
- Creates one shared production `NotionTransport`/client set from `env.NOTION_PAT`.
- Injects the authenticated MCP user requirement into all seven new tools.

- [ ] **Step 1: Write failing server-wiring tests**

Assert the server registers nine Notion tools total (two read + seven write), all write tools reject unauthenticated execution before their service dependencies are called, and existing read tools remain unchanged.

- [ ] **Step 2: Run wiring/read regression tests and verify RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-write-server-wiring.test.ts tests/notion-server-wiring.test.ts tests/notion-mcp-tools.test.ts tests/mcp-read-contract.test.ts
```

- [ ] **Step 3: Wire production dependencies**

Instantiate focused clients lazily from the same `NOTION_PAT` transport and register all write tools in `createMcpServer()`.

- [ ] **Step 4: Run wiring/read regression tests and verify GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/notion-write-server-wiring.test.ts tests/notion-server-wiring.test.ts tests/notion-mcp-tools.test.ts tests/mcp-read-contract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server/create-server.ts tests/notion-write-server-wiring.test.ts tests/notion-server-wiring.test.ts .env.example
git commit -m "feat: wire Notion writes into MCP"
```

### Task 7: Full verification, production deploy, disposable live smoke

**Files:**
- Create/modify verification workflow only if the branch otherwise has no executable CI path.
- No database migration.

- [ ] **Step 1: Run focused Notion suite**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/notion-transport.test.ts \
  tests/notion-read-client.test.ts \
  tests/notion-page-block-client.test.ts \
  tests/notion-structure-client.test.ts \
  tests/notion-comment-client.test.ts \
  tests/notion-file-upload-client.test.ts \
  tests/notion-write-mcp-tools.test.ts \
  tests/notion-write-server-wiring.test.ts \
  tests/notion-mcp-tools.test.ts \
  tests/notion-server-wiring.test.ts \
  tests/mcp-read-contract.test.ts
```

Expected: 0 failures.

- [ ] **Step 2: Run project verification**

```bash
pnpm test
pnpm typecheck
pnpm build
cd web && npm ci && npm run typecheck && npm run build
cd ..
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Compare feature branch to production**

Expected changed scope: Notion domain/tool/tests/docs/CI only; no migrations and no unrelated PWA/UI changes.

- [ ] **Step 4: Fast-forward production only after verification passes**

Use a non-force fast-forward from `feat/notion-global-write` to `codex/phase-6-web-ui-foundation`.

- [ ] **Step 5: Wait for Railway/Vercel deployment success**

Railway must report success for the API commit; Vercel must not regress.

- [ ] **Step 6: Run disposable live MCP smoke**

Through authenticated LeileiOS MCP, create a temporary page named `LeileiOS Notion write smoke <timestamp>`, update content/title, append/update a block, create/update/reply to a temporary comment where permitted, trash/restore the page/block, and read it back. For database/data-source/view, create a temporary structure only if the current PAT/API supports the action in the workspace, then update and trash disposable content. Do not mutate existing user pages.

- [ ] **Step 7: File-upload smoke**

Upload a tiny disposable UTF-8 text file using `create`→`send`→`complete`, attach the returned file-upload ID to disposable Notion content, verify read-back, then trash the disposable page.

- [ ] **Step 8: Close phase only with fresh evidence**

Record exact CI result, production commit SHA, Railway/Vercel status, and which live-smoke operations succeeded or were blocked by an upstream Notion capability/plan constraint.
