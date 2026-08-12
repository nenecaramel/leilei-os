# Todo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Home's prototype/localStorage Todo source of truth with authenticated PostgreSQL-backed L/G Todo papers, conservative legacy migration, and revision-based stale-write protection while preserving the accepted Todo paper interaction.

**Architecture:** Add `todo_papers` and `todo_entries` behind a focused Todo repository/service/router, then add a small Web Todo API/types layer that Home consumes. Legacy localStorage becomes migration-only; Home reads and writes server papers, and whole-paper PUTs use optimistic concurrency with a durable `revision`.

**Tech Stack:** TypeScript, Node.js, Express 5, Drizzle ORM/PostgreSQL, React 19, Auth0 Web API client, Node `tsx --test` tests.

## Global Constraints

- Implementation base is the final accepted Package A production commit `de3c0fe8e57491160342e8ee913299715e5e9108` on `codex/phase-6-web-ui-foundation`.
- Migration head at the base is exactly `drizzle/0015_lg_author_foundation.sql`; Todo migration must become index `0016`.
- Reuse Package A's `ContentAuthor` TypeScript vocabulary from `src/domains/content-author.ts` and PostgreSQL `content_author` enum; Todo authors are exactly `L | G`.
- Todo paper identity is exactly `(authenticated user, business_date, author)`; client requests never send `user_id`/`userId`.
- Business date is browser/device-local `YYYY-MM-DD`; the server validates the supplied real calendar date and never decides which date is today.
- Entry kinds are exactly `pending | completed | record`; entries have stable client ids, trimmed non-empty text, array order, and no per-entry author field.
- Missing paper and existing empty paper are distinct durable states.
- A missing paper saves with `revision: null`; an existing paper saves with the loaded integer revision; stale or create-race writes return HTTP `409` with code `TODO_PAPER_CONFLICT` and do not mutate data.
- Whole-paper replacement is one transaction; any failure leaves the previous entries and revision unchanged.
- `/api/v1/todo/dates` reports only dates containing at least one durable non-empty Todo entry; an existing empty paper does not count.
- Home must never use legacy localStorage as ordinary truth/cache/fallback after Package B. Load failure is explicit and retryable.
- Legacy namespace is `leilei.home.todo-paper.v1:{YYYY-MM-DD}:{L|G}`. Terminal migration marker namespace is `leilei.home.todo-paper.migration.v1:{YYYY-MM-DD}:{L|G}` with states exactly `migrated | server-wins | invalid`.
- Raw legacy JSON remains untouched. Terminal-marked keys are ignored permanently by normal migration discovery. Transient network/5xx failures create no terminal marker.
- Fixture seed Todo is never uploaded and disappears from Home's real-data path.
- Preserve current L/G cards, paper shell, date/signature treatment, editing/order/Enter behavior, status cycle, and close-to-save behavior. No Todo visual redesign.
- Do not add Todo to MCP, Global Search, Day Space, Calendar, or PWA runtime in Package B. MCP remains the accepted A count (16 tools / 5 writes).
- Package B implementation stops before production database migration, Railway/Vercel deployment, merge to the accepted production branch, or any PWA branch mutation.

## File Structure

### Backend

- Create `src/domains/todo/todo-types.ts` — shared Todo domain records, entry kinds, repository result types, and stable conflict code.
- Create `src/domains/todo/todo-repository.ts` — user-scoped reads, content-date listing, transactional whole-paper create/replace.
- Create `src/domains/todo/todo-service.ts` — date/author/entry validation, normalization, duplicate-id checks, repository orchestration.
- Create `src/web-api/todo-router.ts` — authenticated Todo HTTP contract and stable envelope/error mapping.
- Modify `src/database/schema.ts` — `todo_entry_kind`, `todo_papers`, `todo_entries` and constraints.
- Modify `src/web-api/router.ts` — mount `/todo` before unrelated routes.
- Modify `src/app/create-app.ts` — construct/inject Todo service with the existing authenticated Web API dependency graph.
- Create `drizzle/0016_todo_foundation.sql` and `drizzle/meta/0016_snapshot.json`; modify `drizzle/meta/_journal.json` through Drizzle generation.

### Web

- Create `web/src/pages/todo-types.ts` — Web Todo `TodoEntry`, `TodoPaper`, and day payload types; no entry author.
- Create `web/src/pages/todo-api.ts` — narrow GET day/list dates/PUT paper helpers over `WebApiClient`.
- Create `web/src/pages/todo-legacy-migration.ts` — legacy key discovery, strict parsing/normalization, fixture rejection, terminal markers, server-wins orchestration.
- Modify `web/src/api/useWebApiClient.ts` — backwards-compatible typed API error exposing status/code/safe message.
- Modify `web/src/pages/home-prototype-data.ts` — retain calendar prototype data only; Todo fixture constants leave the real render path.
- Modify `web/src/pages/todo-paper-storage.ts` — keep local-date/id helpers and legacy parsing/key helpers; remove normal source-of-truth read/write behavior from Home.
- Modify `web/src/pages/TodoPaperEditor.tsx` — edit real `TodoEntry[]`; author is separate only for UI/id generation.
- Modify `web/src/pages/TodoPaperDialog.tsx` — async revision-aware PUT, one in-flight close/save gate, conflict/error preservation.
- Modify `web/src/pages/DashboardPage.tsx` — server load/retry, L/G paper state, successful preview update, background legacy migration, local-date rollover with dirty-paper protection.
- Modify `web/src/styles.css` only for lightweight existing-style load/retry/conflict/migration status surfaces; no paper redesign.

### Tests

- Create `tests/todo-schema-migration.test.ts`.
- Create `tests/todo-repository.integration.test.ts`.
- Create `tests/todo-service.test.ts`.
- Create `tests/todo-api.test.ts`.
- Create `tests/web-api-client-error.test.ts`.
- Create `tests/todo-legacy-migration.test.ts`.
- Create `tests/todo-home-api.test.ts`.
- Modify `tests/todo-paper-dialog.test.ts`.
- Modify `tests/todo-paper-storage.test.ts`.
- Modify `tests/dashboard-page.test.ts` and `tests/mobile-home-shell.test.ts` only where the old fixture/localStorage assumptions are replaced by server Todo behavior.

---

### Task 1: Todo schema and additive migration

**Files:**
- Modify: `src/database/schema.ts`
- Create: `tests/todo-schema-migration.test.ts`
- Create: `drizzle/0016_todo_foundation.sql`
- Create: `drizzle/meta/0016_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: existing `users.id` FK convention and `contentAuthorEnum` from `src/database/schema.ts`.
- Produces: exported `todoEntryKindEnum`, `todoPapers`, and `todoEntries` used by Task 2.

- [ ] **Step 1: Write the failing schema/migration contract test**

Create `tests/todo-schema-migration.test.ts` with assertions that import/read the schema and generated SQL and require all of these exact invariants:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { todoEntries, todoEntryKindEnum, todoPapers } from "../src/database/schema.js";

test("Todo schema uses shared author enum and relational paper/entry constraints", async () => {
  assert.deepEqual(todoEntryKindEnum.enumValues, ["pending", "completed", "record"]);
  assert.equal(todoPapers.author.enumName, "content_author");
  assert.equal(todoPapers.revision.notNull, true);
  assert.equal(todoEntries.paperId.notNull, true);

  const sql = await readFile("drizzle/0016_todo_foundation.sql", "utf8");
  assert.match(sql, /CREATE TYPE "public"\."todo_entry_kind" AS ENUM\('pending', 'completed', 'record'\)/);
  assert.match(sql, /CREATE TABLE "todo_papers"/);
  assert.match(sql, /CREATE TABLE "todo_entries"/);
  assert.match(sql, /content_author/);
  assert.match(sql, /revision.*CHECK|CHECK.*revision/s);
  assert.match(sql, /business_date/);
  assert.match(sql, /paper_id/);
});
```

Add explicit SQL-string assertions for unique `(user_id,business_date,author)`, unique `(paper_id,entry_id)`, unique `(paper_id,position)`, non-negative `revision`/`position`, and non-blank `entry_id`/`text`.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm exec tsx --test tests/todo-schema-migration.test.ts
```

Expected: FAIL because Todo schema exports and `0016_todo_foundation.sql` do not exist.

- [ ] **Step 3: Add the minimal Drizzle schema**

In `src/database/schema.ts`, add:

```ts
export const todoEntryKindEnum = pgEnum("todo_entry_kind", [
  "pending",
  "completed",
  "record",
]);

export const todoPapers = pgTable(
  "todo_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
    businessDate: date("business_date").notNull(),
    author: contentAuthorEnum("author").notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("todo_papers_user_date_author_uidx").on(
      table.userId,
      table.businessDate,
      table.author,
    ),
    check("todo_papers_revision_nonnegative", sql`${table.revision} >= 0`),
  ],
);

export const todoEntries = pgTable(
  "todo_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => todoPapers.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entryId: text("entry_id").notNull(),
    kind: todoEntryKindEnum("kind").notNull(),
    text: text("text").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("todo_entries_paper_entry_uidx").on(table.paperId, table.entryId),
    uniqueIndex("todo_entries_paper_position_uidx").on(table.paperId, table.position),
    check("todo_entries_entry_id_nonblank", sql`length(btrim(${table.entryId})) > 0`),
    check("todo_entries_text_nonblank", sql`length(btrim(${table.text})) > 0`),
    check("todo_entries_position_nonnegative", sql`${table.position} >= 0`),
  ],
);
```

- [ ] **Step 4: Generate migration 0016 with the fixed name**

Run from the repo root with a non-production syntactically valid config URL only to satisfy config parsing:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/leilei_schema_generate \
  pnpm exec drizzle-kit generate --name todo_foundation
```

Expected generated artifacts: `drizzle/0016_todo_foundation.sql`, `drizzle/meta/0016_snapshot.json`, and updated `drizzle/meta/_journal.json`. Inspect the SQL and reject any unrelated table/enum changes.

- [ ] **Step 5: Run schema contract and existing author migration contract**

```bash
pnpm exec tsx --test tests/todo-schema-migration.test.ts tests/author-schema-migration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/database/schema.ts drizzle/0016_todo_foundation.sql drizzle/meta/0016_snapshot.json drizzle/meta/_journal.json tests/todo-schema-migration.test.ts
git commit -m "feat: add Todo paper schema"
```

---

### Task 2: Transactional Todo repository

**Files:**
- Create: `src/domains/todo/todo-types.ts`
- Create: `src/domains/todo/todo-repository.ts`
- Create: `tests/todo-repository.integration.test.ts`

**Interfaces:**
- Consumes: `todoPapers`, `todoEntries`, `ContentAuthor`.
- Produces:

```ts
export const TODO_ENTRY_KINDS = ["pending", "completed", "record"] as const;
export type TodoEntryKind = (typeof TODO_ENTRY_KINDS)[number];
export type TodoEntry = { id: string; kind: TodoEntryKind; text: string };
export type TodoPaper = {
  author: ContentAuthor;
  date: string;
  revision: number;
  entries: TodoEntry[];
};
export type TodoDayPapers = { L: TodoPaper | null; G: TodoPaper | null };
export type ReplaceTodoPaperInput = {
  userId: string;
  date: string;
  author: ContentAuthor;
  expectedRevision: number | null;
  entries: TodoEntry[];
};
export type ReplaceTodoPaperResult =
  | { outcome: "committed"; paper: TodoPaper }
  | { outcome: "conflict" };
```

Repository interface:

```ts
export interface TodoRepository {
  readDay(userId: string, date: string): Promise<TodoDayPapers>;
  listContentDates(userId: string): Promise<string[]>;
  replacePaper(input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult>;
}
```

- [ ] **Step 1: Write failing integration tests**

Create `tests/todo-repository.integration.test.ts` behind `RUN_TODO_DATABASE_TEST=1`. Use the same disposable-DB helpers/pattern as existing repository integration tests. Cover separate tests for:

```ts
assert.equal((await repo.readDay(userA, "2026-08-12")).L, null);
assert.deepEqual((await repo.listContentDates(userA)), []);

const first = await repo.replacePaper({
  userId: userA,
  date: "2026-08-12",
  author: "L",
  expectedRevision: null,
  entries: [
    { id: "l-1", kind: "pending", text: "one" },
    { id: "l-2", kind: "record", text: "two" },
  ],
});
assert.equal(first.outcome, "committed");
if (first.outcome === "committed") assert.equal(first.paper.revision, 1);
```

Then verify: L/G isolation, user isolation, entry order, all three kinds, exact revision `1 -> 2`, stale revision conflict with unchanged rows/revision, `revision:null` create race conflict, durable empty replacement, empty-only date absent from `listContentDates`, and one author's content keeping the date present when the other is empty.

Add one forced mid-transaction failure test by wrapping/injecting a transaction hook or test-only persistence seam that throws after deleting old entries but before inserting replacements; assert the previously committed paper and revision are unchanged after rollback.

- [ ] **Step 2: Run the repository test to verify RED**

```bash
RUN_TODO_DATABASE_TEST=1 DATABASE_URL="$TODO_TEST_DATABASE_URL" \
  pnpm exec tsx --test tests/todo-repository.integration.test.ts
```

Expected: FAIL because Todo repository/types do not exist.

- [ ] **Step 3: Implement focused types and repository**

`todo-repository.ts` must:

```ts
async readDay(userId, date) { /* query paper rows for user/date; fetch entries ordered by position; return {L,G} */ }
async listContentDates(userId) { /* distinct paper business_date joined to >=1 entry; sorted ascending */ }
async replacePaper(input) { /* transaction + create/lock + revision compare + replace + increment */ }
```

For existing papers, acquire a row lock before revision comparison. For `expectedRevision: null`, attempt create-only semantics and translate the unique `(user,date,author)` race into `{ outcome: "conflict" }`. For a matched existing revision, delete that paper's entries, insert normalized array positions `0..n-1`, update `revision = revision + 1` and `updated_at`, and return the transaction's committed representation. Do not expose DB surrogate entry UUIDs in `TodoEntry`.

- [ ] **Step 4: Run integration tests GREEN**

```bash
RUN_TODO_DATABASE_TEST=1 DATABASE_URL="$TODO_TEST_DATABASE_URL" \
  pnpm exec tsx --test tests/todo-repository.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/todo/todo-types.ts src/domains/todo/todo-repository.ts tests/todo-repository.integration.test.ts
git commit -m "feat: add transactional Todo repository"
```

---

### Task 3: Todo service validation and conflict semantics

**Files:**
- Create: `src/domains/todo/todo-service.ts`
- Create: `tests/todo-service.test.ts`

**Interfaces:**
- Consumes: `TodoRepository`, `ContentAuthor`, `isContentAuthor`, `TODO_ENTRY_KINDS`.
- Produces:

```ts
export class TodoServiceError extends Error {
  constructor(
    public readonly code:
      | "TODO_DATE_INVALID"
      | "TODO_AUTHOR_INVALID"
      | "TODO_REVISION_INVALID"
      | "TODO_ENTRY_INVALID"
      | "TODO_ENTRY_ID_DUPLICATE"
      | "TODO_PAPER_CONFLICT",
    message: string,
  ) { super(message); }
}

export class TodoService {
  constructor(private readonly repository: TodoRepository) {}
  readDay(userId: string, date: string): Promise<{ date: string; papers: TodoDayPapers }>;
  listDates(userId: string): Promise<string[]>;
  replacePaper(input: {
    userId: string;
    date: string;
    author: unknown;
    revision: unknown;
    entries: unknown;
  }): Promise<TodoPaper>;
}
```

- [ ] **Step 1: Write failing unit tests**

Test a fake repository and require:

```ts
await assert.rejects(
  () => service.readDay("u", "2026-02-30"),
  (error: unknown) => error instanceof TodoServiceError && error.code === "TODO_DATE_INVALID",
);
```

Add cases for malformed format, leap-day correctness, invalid author, revision rules (`null` or non-negative integer only), invalid entries array/row/kind/id/text, duplicate ids, trimming, dropping empty text rows before repository call, preserving order/kind/id, repository conflict -> `TODO_PAPER_CONFLICT`, and no repository mutation call on any validation failure.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/todo-service.test.ts
```

Expected: FAIL because service is absent.

- [ ] **Step 3: Implement strict calendar and entry normalization**

Use a date validator that first requires `/^\d{4}-\d{2}-\d{2}$/`, then round-trips UTC calendar components so `2026-02-30` is rejected without converting the business date to a timestamp. Normalize each valid row to exactly `{ id, kind, text: text.trim() }`, drop rows whose trimmed text is empty, reject duplicate non-empty ids before calling the repository, and map repository `{ outcome: "conflict" }` to `TodoServiceError("TODO_PAPER_CONFLICT", "Todo paper changed on another device.")`.

- [ ] **Step 4: Run GREEN**

```bash
pnpm exec tsx --test tests/todo-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/todo/todo-service.ts tests/todo-service.test.ts
git commit -m "feat: add Todo service rules"
```

---

### Task 4: Authenticated Todo Web API

**Files:**
- Create: `src/web-api/todo-router.ts`
- Modify: `src/web-api/router.ts`
- Modify: `src/app/create-app.ts`
- Create: `tests/todo-api.test.ts`

**Interfaces:**
- Consumes: `TodoService` methods from Task 3 and existing `request.webUserId` authentication middleware contract.
- Produces:
  - `GET /api/v1/todo/dates`
  - `GET /api/v1/todo/:date`
  - `PUT /api/v1/todo/:date/:author`

- [ ] **Step 1: Write failing router tests**

Build the router/app with a fake Todo service and authenticated `webUserId`. Assert literal `/dates` reaches `listDates`, never `readDay("dates")`. Assert day response preserves both slots including `null` vs `{ entries: [] }`. Assert PUT never accepts/forwards a body `userId`, takes author from URL, and forwards the authenticated user.

Require conflict response exactly:

```ts
assert.equal(response.status, 409);
assert.deepEqual(response.body, {
  success: false,
  error: {
    code: "TODO_PAPER_CONFLICT",
    message: "Todo paper changed on another device.",
  },
});
```

Also require stable 400 mapping for all validation service codes and safe 500 mapping without leaking internal exceptions.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/todo-api.test.ts
```

Expected: FAIL because Todo router/dependency is absent.

- [ ] **Step 3: Implement router and app wiring**

Register `router.get("/dates", ...)` before `router.get("/:date", ...)`. PUT body extraction must pass only `revision` and `entries`; author is `request.params.author`. Extend `WebApiRouterDependencies` with required `todo: TodoApiDependencies`, mount `router.use("/todo", createTodoApiRouter(dependencies.todo))`, and add `webTodoService?: TodoApiDependencies["todoService"]` to `AppDependencies`. Construct `TodoService(new DrizzleTodoRepository(db))` beside the existing Memory/Diary/Task services when DB-backed dependencies are needed.

- [ ] **Step 4: Run Todo API plus auth regression tests**

```bash
pnpm exec tsx --test tests/todo-api.test.ts tests/web-api-auth.test.ts tests/web-memory-api.test.ts tests/task-api.test.ts tests/diary-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web-api/todo-router.ts src/web-api/router.ts src/app/create-app.ts tests/todo-api.test.ts
git commit -m "feat: expose authenticated Todo API"
```

---

### Task 5: Web Todo types, API helpers, and typed API errors

**Files:**
- Create: `web/src/pages/todo-types.ts`
- Create: `web/src/pages/todo-api.ts`
- Modify: `web/src/api/useWebApiClient.ts`
- Create: `tests/web-api-client-error.test.ts`
- Create: `tests/todo-home-api.test.ts`

**Interfaces:**
- Produces Web types:

```ts
export type TodoAuthor = "L" | "G";
export type TodoEntryKind = "pending" | "completed" | "record";
export type TodoEntry = { id: string; kind: TodoEntryKind; text: string };
export type TodoPaper = {
  author: TodoAuthor;
  date: string;
  revision: number;
  entries: TodoEntry[];
};
export type TodoDay = {
  date: string;
  papers: { L: TodoPaper | null; G: TodoPaper | null };
};
```

- Produces helpers:

```ts
export function loadTodoDay(api: WebApiClient, date: string): Promise<TodoDay>;
export function listTodoDates(api: WebApiClient): Promise<string[]>;
export function saveTodoPaper(
  api: WebApiClient,
  input: { date: string; author: TodoAuthor; revision: number | null; entries: TodoEntry[] },
): Promise<TodoPaper>;
```

- Produces backwards-compatible error class:

```ts
export class WebApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) { super(message); }
}
```

- [ ] **Step 1: Write RED tests for safe error parsing and Todo HTTP shapes**

Mock `fetch`/`WebApiClient` and assert a `409` envelope becomes `WebApiError` with `status === 409`, `code === "TODO_PAPER_CONFLICT"`, and server safe message. Malformed/non-JSON errors must still become `WebApiError(status, null, "Web API request failed (STATUS).")`. Existing callers that only catch `Error` remain valid because `WebApiError extends Error`.

For Todo helpers assert exact paths/method/body:

```ts
await loadTodoDay(api, "2026-08-12"); // GET /todo/2026-08-12
await listTodoDates(api);             // GET /todo/dates
await saveTodoPaper(api, {
  date: "2026-08-12",
  author: "G",
  revision: 2,
  entries: [{ id: "g-1", kind: "record", text: "x" }],
});
// PUT /todo/2026-08-12/G with body containing revision+entries only
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/web-api-client-error.test.ts tests/todo-home-api.test.ts
```

Expected: FAIL because the new types/helpers/error class are absent.

- [ ] **Step 3: Implement the narrow client enhancement and helpers**

On non-2xx, attempt to parse only `{ error: { code?: string; message?: string } }`; never trust arbitrary response text as a message. Keep the request success behavior unchanged. Todo helpers unwrap the existing `{ success, data }` payload returned by the shared client exactly as existing page callers expect.

- [ ] **Step 4: Run GREEN and representative Web regressions**

```bash
pnpm exec tsx --test tests/web-api-client-error.test.ts tests/todo-home-api.test.ts tests/memory-page.test.ts tests/diary-page.test.ts tests/task-detail-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/useWebApiClient.ts web/src/pages/todo-types.ts web/src/pages/todo-api.ts tests/web-api-client-error.test.ts tests/todo-home-api.test.ts
git commit -m "feat: add Todo Web API contract"
```

---

### Task 6: One-time legacy localStorage migration

**Files:**
- Create: `web/src/pages/todo-legacy-migration.ts`
- Modify: `web/src/pages/todo-paper-storage.ts`
- Modify: `web/src/pages/home-prototype-data.ts`
- Modify: `tests/todo-paper-storage.test.ts`
- Create: `tests/todo-legacy-migration.test.ts`

**Interfaces:**
- Consumes: `TodoAuthor`, `TodoEntry`, `loadTodoDay`, `saveTodoPaper`, `WebApiError`.
- Produces:

```ts
export type TodoMigrationTerminalState = "migrated" | "server-wins" | "invalid";
export type TodoMigrationNotice = { date: string; author: TodoAuthor; state: "server-wins" };

export async function migrateLegacyTodoPapers(input: {
  storage: Storage;
  api: WebApiClient;
  onNotice?: (notice: TodoMigrationNotice) => void;
}): Promise<void>;
```

Keep/export helpers for exact namespaces:

```ts
legacyTodoPaperKey(author, date)
legacyTodoMigrationMarkerKey(author, date)
listLegacyTodoPaperCandidates(storage)
parseLegacyTodoPaper(raw, author)
```

- [ ] **Step 1: Write exhaustive RED migration tests**

Use an in-memory `Storage` fake and fake `WebApiClient`. Require independently:
- absent server + valid legacy -> create-only PUT `revision:null` -> marker `migrated`;
- contentful server -> no PUT -> marker `server-wins`;
- existing empty server -> no PUT -> marker `server-wins`;
- PUT 409 create race -> marker `server-wins`;
- invalid JSON/invalid row/wrong row author -> no upload, raw unchanged, marker `invalid`;
- network/5xx -> no terminal marker, raw unchanged;
- L success + G transient failure -> L terminal marker remains and G remains retryable;
- multiple historical dates discovered independently;
- terminal marker causes raw key to be ignored;
- old fixture arrays are detected exactly and never uploaded;
- valid rows trim text, drop empty rows, preserve id/order/kind, and remove row author from PUT entries;
- `onNotice` is called only for newly terminal `server-wins`, never `migrated`/`invalid`, and never again once marker exists.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/todo-paper-storage.test.ts tests/todo-legacy-migration.test.ts
```

Expected: FAIL on the new migration contract.

- [ ] **Step 3: Convert storage code from truth adapter to migration utility**

Keep `formatTodoStorageDate`, `formatTodoPaperDate`, and `createTodoPaperEntryId`. Remove Home-oriented `readTodoPaperEntries(...seed)`/`writeTodoPaperEntries(...)` usage. Discovery must only recognize `^leilei\.home\.todo-paper\.v1:(\d{4}-\d{2}-\d{2}):(L|G)$`; markers use `leilei.home.todo-paper.migration.v1`. Store terminal marker metadata as JSON containing `state` only (and optional schema version), never Todo text.

Move/retain the exact old L/G fixture payload constants only where migration can compare normalized legacy payloads; `DashboardPage` must not import them.

Group candidates by date so one `GET /todo/:date` can establish server L/G existence, then migrate each author independently. Only write a terminal marker after a final result; catch transient errors and leave that candidate unmarked.

- [ ] **Step 4: Run GREEN**

```bash
pnpm exec tsx --test tests/todo-paper-storage.test.ts tests/todo-legacy-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/todo-legacy-migration.ts web/src/pages/todo-paper-storage.ts web/src/pages/home-prototype-data.ts tests/todo-paper-storage.test.ts tests/todo-legacy-migration.test.ts
git commit -m "feat: migrate legacy Todo papers conservatively"
```

---

### Task 7: Revision-aware Todo editor/dialog persistence

**Files:**
- Modify: `web/src/pages/TodoPaperEditor.tsx`
- Modify: `web/src/pages/TodoPaperDialog.tsx`
- Modify: `tests/todo-paper-dialog.test.ts`

**Interfaces:**
- Consumes: `TodoEntry`, `TodoPaper`, `saveTodoPaper`, `WebApiError`.
- Produces dialog callbacks:

```ts
onSaved: (paper: TodoPaper) => void;
onDirtyChange?: (dirty: boolean) => void;
```

Dialog inputs include `api`, `author`, `dateKey`, and `paper: TodoPaper | null` instead of localStorage `Storage`.

- [ ] **Step 1: Rewrite/add RED dialog tests around server persistence**

Keep all accepted editing/keyboard/status-cycle tests. Replace localStorage-save assertions with:

```ts
// missing paper
assert.deepEqual(putBody, { revision: null, entries: normalizedEntries });

// existing paper revision 4
assert.deepEqual(putBody, { revision: 4, entries: normalizedEntries });
```

Require: clean close makes no PUT; dirty close waits for PUT before closing; success calls `onSaved` with returned committed paper; ordinary failure keeps dialog open and exact editor text/status state; `WebApiError(409,"TODO_PAPER_CONFLICT",...)` keeps dialog open with conflict message; repeated close/Escape/veil attempts during one in-flight PUT cause exactly one request; empty normalized list saves as `entries: []` rather than deleting paper identity.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/todo-paper-dialog.test.ts
```

Expected: FAIL because dialog still writes localStorage and editor rows still contain author.

- [ ] **Step 3: Convert editor to real entry shape and dialog to async PUT**

`TodoPaperEditor` rows become `TodoEntry & { creation?: boolean }`; `author` remains a separate prop only for generating new client ids/signature context. `getNormalizedEntries()` returns `TodoEntry[]` with no author property.

In `TodoPaperDialog`, implement an explicit `savingRef`/promise gate. `handleRequestClose` returns `Promise<boolean>`: clean -> `true`; already saving -> `false`; dirty -> save exact current normalized entries with loaded revision, then call `onSaved(committedPaper)` and return `true`; catch conflict/ordinary errors, set inline message, return `false`, and do not reset editor rows.

- [ ] **Step 4: Run GREEN plus paper layout regressions**

```bash
pnpm exec tsx --test tests/todo-paper-dialog.test.ts tests/paper-dialog-scroll-lock-regression.test.ts tests/mobile-home-shell.test.ts
```

Expected: PASS with no paper geometry redesign.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/TodoPaperEditor.tsx web/src/pages/TodoPaperDialog.tsx tests/todo-paper-dialog.test.ts
git commit -m "feat: persist Todo paper edits through API"
```

---

### Task 8: Home server load, retry, migration, and local-date rollover

**Files:**
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/styles.css`
- Modify: `tests/dashboard-page.test.ts`
- Modify: `tests/mobile-home-shell.test.ts`
- Create: `tests/todo-home-date-rollover.test.ts`

**Interfaces:**
- Consumes: `loadTodoDay`, `migrateLegacyTodoPapers`, `TodoPaperDialog` callbacks, local-date helpers.
- Produces: Home where L/G Todo panels are server-backed for the active device-local business date.

- [ ] **Step 1: Write RED Home tests**

Require all of these observable behaviors:

```ts
// first render/load
assert.equal(requests[0].path, `/todo/${localDate}`);
// missing L/G -> TodayPanel receives [] for each; no fixture text appears
// returned paper entries -> matching preview text/status appears
```

Add tests for: load failure renders explicit retry and never legacy/fixture Todo; retry reissues GET and then renders server data; successful dialog PUT updates only matching L/G preview from returned committed paper; background migration starts only after authenticated API is available and does not block today's successful render; a server-wins migration notice is lightweight/nonblocking.

For date rollover, use a controllable `Date`/clock and dispatch `visibilitychange`/`focus`: when local date changes and no dirty dialog exists, Home GETs the new date and does not carry previous entries. If a paper is dirty, defer rebinding while it is open; after successful/explicit close, apply the pending local date and load the new day. This prevents silently discarding dirty edits while also preventing Home from remaining permanently on yesterday.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test tests/dashboard-page.test.ts tests/mobile-home-shell.test.ts tests/todo-home-date-rollover.test.ts
```

Expected: FAIL because Home still initializes from localStorage/fixtures and pins `today` at mount.

- [ ] **Step 3: Implement server-backed Home state without redesign**

Replace fixture/localStorage initialization with states shaped as `TodoPaper | null` plus load state `loading | ready | error`. Derive current local date through `formatTodoStorageDate(new Date())`. On load success set both paper slots exactly from server. On failure render a small existing-style failure/retry surface and keep server truth unknown; do not render raw legacy content as current Todo.

Pass `paper?.entries ?? []` to each `TodayPanel`. Open `TodoPaperDialog` with the selected server paper (or null). On `onSaved`, replace only that author's paper with the committed response. Track dialog dirty state for rollover deferral.

Install focus/visibility listeners while mounted. On a suitable foreground event, derive a fresh local date; when it differs, either switch+load immediately or record a pending date while a dirty paper is open. Run `migrateLegacyTodoPapers` best-effort after a successful authenticated Todo load; migration errors must not replace today's successful UI with an error state.

- [ ] **Step 4: Run GREEN and Home visual regressions**

```bash
pnpm exec tsx --test tests/dashboard-page.test.ts tests/mobile-home-shell.test.ts tests/todo-home-date-rollover.test.ts tests/todo-paper-dialog.test.ts
```

Expected: PASS; accepted L/G panel/paper structure remains intact.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/DashboardPage.tsx web/src/styles.css tests/dashboard-page.test.ts tests/mobile-home-shell.test.ts tests/todo-home-date-rollover.test.ts
git commit -m "feat: connect Home Todo to server"
```

---

### Task 9: Disposable PostgreSQL migration proof and full Package B gate

**Files:**
- Modify only if verification exposes a real defect in Package B files. Do not add scope to make unrelated assertions pass.

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: one verified isolated Package B branch ready for code review and later production rollout approval; it does not migrate/deploy production.

- [ ] **Step 1: Prove the actual 0000 -> 0016 chain on disposable PostgreSQL**

Create a disposable PostgreSQL database/container, point `DATABASE_URL` only at that disposable instance, run:

```bash
pnpm db:migrate
pnpm db:check
```

Then query `todo_papers`, `todo_entries`, `todo_entry_kind`, and `content_author` to verify constraints/enums exist. Insert two users and prove the unique paper identity and non-negative/non-blank constraints at SQL level. Drop the disposable database/container afterward. Never use the production Railway `DATABASE_URL` for this task.

- [ ] **Step 2: Run Todo focused tests including DB integration**

```bash
pnpm exec tsx --test \
  tests/todo-schema-migration.test.ts \
  tests/todo-service.test.ts \
  tests/todo-api.test.ts \
  tests/web-api-client-error.test.ts \
  tests/todo-home-api.test.ts \
  tests/todo-paper-storage.test.ts \
  tests/todo-legacy-migration.test.ts \
  tests/todo-paper-dialog.test.ts \
  tests/todo-home-date-rollover.test.ts \
  tests/dashboard-page.test.ts

RUN_TODO_DATABASE_TEST=1 DATABASE_URL="$TODO_TEST_DATABASE_URL" \
  pnpm exec tsx --test tests/todo-repository.integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run deterministic full repository suite**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

Expected: 0 failures. Record the exact passed/skipped totals from this fresh run.

- [ ] **Step 4: Run compile/build gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
git status --short
```

Expected: all pass; worktree is clean after committed changes.

- [ ] **Step 5: Run explicit scope guards**

Compare against `de3c0fe8e57491160342e8ee913299715e5e9108` and assert:

```bash
git diff --name-only de3c0fe8e57491160342e8ee913299715e5e9108...HEAD
```

Allowed changes are Todo schema/domain/API/Web/Home/tests plus this plan and generated migration metadata. Reject changes to `src/mcp/**`, Global Search behavior, Day Space UI, Calendar UI, PWA runtime/config/assets, Memory/Diary/Task product behavior, Auth0/CORS policy, or production operations.

Run MCP contract tests and assert accepted A inventory remains exactly 16 tools and 5 writes; no Todo MCP registration exists. Run representative Memory/Diary/Task tests to confirm no author regressions.

- [ ] **Step 6: Inspect secrets and production boundary**

Run repository secret scan conventions plus:

```bash
git diff de3c0fe8e57491160342e8ee913299715e5e9108...HEAD -- . ':!web/package-lock.json'
```

Confirm no `DATABASE_URL`, Auth0 token, Vercel token, Railway token, local `.env`, backup, or generated preview helper was committed. Confirm no production migration/deploy command was executed.

- [ ] **Step 7: Final branch review and commit any verification-only test correction**

```bash
git log --oneline --decorate -12
git status --short
git diff --check
```

Expected: coherent task commits, clean status, no placeholders such as `TBD`, `implement later`, or untracked helpers. Stop here for Package B review/production-rollout decision; do not merge/deploy/migrate production from this implementation task.
