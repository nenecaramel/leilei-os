# C Author Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend LeileiOS logical content authorship from `L | G` to `L | G | C` across Memory, Diary, Task, Todo, Web, MCP, Home, Day Space, Global Search, and import/export without changing legacy data or inferring author from connector identity.

**Architecture:** Add C once to the shared `ContentAuthor` vocabulary and PostgreSQL enum, then remove every downstream closed L/G assumption. Preserve existing module semantics: explicit authored writes, nullable legacy reads, Todo paper isolation by date and author, and connector-independent authorship.

**Tech Stack:** TypeScript, Node.js, Express, Drizzle ORM, PostgreSQL, React, Vite, Auth0, MCP SDK, Zod, `node:test` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-05-c-author-parity-design.md`

## Global Constraints

- Implementation branch: `feat/content-author-c`; approved base: `main@090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76`.
- Design commit: `d69d07cd9cc76fbc544f335d1a820cc20dbc2257`.
- Use an isolated worktree created through `superpowers:using-git-worktrees` before editing.
- The valid logical authors are exactly `L`, `G`, and `C`.
- Author is content ownership, not model identity, OAuth client identity, MCP host, channel, actor, source, or provenance.
- ChatGPT and Claude may each explicitly write any of L, G, or C.
- Never infer author from the active connector or authenticated client.
- Existing L, G, and null records remain byte-for-byte logically unchanged; no backfill or provenance conversion.
- Content creates require explicit author; legacy-null content edits require explicit author; lifecycle and Task status-only actions preserve author.
- Todo exposes exactly three daily slots `{ L, G, C }`; each paper keeps an independent revision.
- No standalone Todo route and no unrelated visual redesign.
- No new author filter for Calendar or Global Search.
- Keep MCP tool names, annotations, authentication, user isolation, and registry counts unchanged.
- PR #278 remains independent; do not cherry-pick or copy its diff.
- Development may commit and open a Draft PR only. Do not merge, deploy, modify Railway/Auth0/OAuth, run a production migration, or create production C data.
- If the local `tsx` runner fails with `listen EPERM` or `listen EINVAL` on an IPC pipe/socket, stop after the first controlled attempt, record the exact command and error, and do not retry with random temporary-directory changes.
- Use TDD for each behavioral task and commit after each independently reviewable green slice.

---

## File Structure Map

**Create**

- `drizzle/0032_content_author_c.sql` — forward-only PostgreSQL enum extension, subject to confirming the actual migration head.
- Generated Drizzle metadata for the new migration under `drizzle/meta/`.
- `tests/content-author-c-migration.test.ts` — exact migration and shared-vocabulary contract.
- `docs/operations/c-author-parity-rollout.md` — production sequencing, smoke tests, and rollback limits.

**Modify: shared/database**

- `src/domains/content-author.ts`
- `src/database/schema.ts`
- `drizzle/meta/_journal.json`

**Modify: Memory**

- `src/domains/memory/memory-repository.ts`
- `src/domains/memory/memory-service.ts`
- `src/web-api/memory-router.ts`
- `src/mcp/tools/write-memory/register.ts`
- `src/mcp/tools/update-memory/register.ts`
- `src/mcp/tools/get-memory/register.ts`
- `src/mcp/tools/read-memory/register.ts`
- `src/mcp/tools/search-memory/register.ts`
- `tests/memory-detail-service.test.ts`
- `tests/memory-repository-update-contract.test.ts`
- `tests/memory-lifecycle-repository.integration.test.ts`
- `tests/web-memory-api.test.ts`
- `tests/write-memory-tool.test.ts`
- `tests/memory-mcp-write.test.ts`
- `tests/memory-read-tools.test.ts`

**Modify: Diary**

- `src/domains/diary/diary-repository.ts`
- `src/domains/diary/diary-service.ts`
- `src/web-api/diary-router.ts`
- `src/mcp/tools/write-diary/register.ts`
- `src/mcp/tools/update-diary/register.ts`
- `src/mcp/tools/get-diary/register.ts`
- `src/mcp/tools/search-diary/register.ts`
- `tests/diary-service.test.ts`
- `tests/diary-repository.integration.test.ts`
- `tests/diary-api.test.ts`
- `tests/diary-lifecycle.test.ts`
- `tests/write-diary-tool.test.ts`
- `tests/diary-read-tools.test.ts`
- `tests/mcp-diary-error-contract.test.ts`

**Modify: Task**

- `src/domains/task/task-repository.ts`
- `src/domains/task/task-service.ts`
- `src/web-api/task-router.ts`
- `src/mcp/tools/create-task/register.ts`
- `src/mcp/tools/update-task/register.ts`
- `src/mcp/tools/get-task/register.ts`
- `src/mcp/tools/list-tasks/register.ts`
- `src/mcp/tools/transition-task/register.ts` only if it contains a closed author output schema; it must never add author to status input.
- `tests/task-service.test.ts`
- `tests/task-api.test.ts`
- `tests/task-lifecycle-repository.integration.test.ts`
- `tests/task-status-reopen.integration.test.ts`
- `tests/create-task-tool.test.ts`
- `tests/task-read-tools.test.ts`
- `tests/task-web-actions.test.ts`

**Modify: Todo and Home**

- `src/domains/todo/todo-types.ts`
- `src/domains/todo/todo-repository.ts`
- `src/domains/todo/todo-service.ts`
- `src/web-api/todo-router.ts`
- `src/mcp/tools/read-todo-day/register.ts`
- `src/mcp/tools/list-todo-dates/register.ts`
- `src/mcp/tools/write-todo-paper/register.ts`
- `web/src/pages/todo-types.ts`
- `web/src/pages/todo-api.ts`
- `web/src/pages/todo-paper-storage.ts`
- `web/src/pages/todo-legacy-migration.ts`
- `web/src/pages/TodoPaperDialog.tsx`
- `web/src/pages/TodoPaperEditor.tsx`
- `web/src/pages/DashboardPage.tsx`
- Home/Todo selectors in `web/src/styles.css`
- `tests/todo-service.test.ts`
- `tests/todo-repository.integration.test.ts`
- `tests/todo-api.test.ts`
- `tests/todo-mcp-tools.test.ts`
- `tests/todo-paper-dialog.test.ts`
- `tests/todo-paper-dialog-server.test.ts`
- `tests/todo-paper-storage.test.ts`
- `tests/todo-legacy-migration.test.ts`
- `tests/todo-home-api.test.ts`
- `tests/todo-home-date-rollover.test.ts`
- `tests/mobile-home-shell.test.ts`

**Modify: shared Web authorship and Day Space**

- `web/src/pages/PaperAuthorSignature.tsx`
- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/MemoryPaperEditor.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/DiaryPaperEditor.tsx`
- `web/src/pages/TaskPage.tsx`
- `web/src/pages/TaskPaperEditor.tsx`
- `web/src/pages/DaySpacePage.tsx`
- `web/src/pages/DaySpaceDiaryDialog.tsx`
- `web/src/pages/day-space-api.ts`
- `web/src/pages/day-space-data.ts`
- `tests/paper-author-signature.test.ts`
- `tests/quick-create.test.ts`
- `tests/web-unsaved-changes.test.ts`
- `tests/memory-page.test.ts`
- `tests/memory-paper-editor.test.ts`
- `tests/diary-page.test.ts`
- `tests/diary-paper-editor.test.ts`
- `tests/task-detail-view.test.ts`
- `tests/task-submission-gate.test.ts`
- `tests/day-space-data.test.ts`
- `tests/day-space-diary-author-signature.test.ts`
- `tests/day-space-real-data.test.ts`
- `tests/day-space-mobile-page.test.ts`

**Modify only where the current closed author contract requires it: import/export/search**

- `src/domains/export/export-types.ts`
- `src/domains/export/export-repository.ts`
- `src/domains/export/export-service.ts`
- `src/domains/import/import-schema.ts`
- `src/domains/import/import-canonical.ts`
- `src/domains/import/import-planner.ts`
- `src/domains/import/import-repository.ts`
- `src/domains/global-search/global-search-repository.ts`
- `src/domains/global-search/global-search-service.ts`
- `src/web-api/export-router.ts`
- `src/web-api/import-router.ts`
- `src/web-api/global-search-router.ts`
- `web/src/system/export-types.ts`
- `web/src/system/import-types.ts`
- `web/src/pages/global-search-result.ts`
- `tests/export-service.test.ts`
- `tests/export-api.test.ts`
- `tests/export-repository.integration.test.ts`
- `tests/import-schema.test.ts`
- `tests/import-planner.test.ts`
- `tests/import-service.test.ts`
- `tests/import-api.test.ts`
- `tests/import-repository.integration.test.ts`
- `tests/global-search.test.ts`
- `tests/global-search-api.test.ts`
- `tests/global-search-repository.integration.test.ts`
- `tests/global-search-web.test.ts`

Do not edit every mapped file mechanically. First inspect each file; edit it only when it contains a closed L/G contract, author serializer, or three-author behavior named by this plan.

---

### Task 0: Isolated Worktree and Test-Runner Preflight

**Files:**
- Read: `docs/superpowers/specs/2026-09-05-c-author-parity-design.md`
- Read: `docs/superpowers/plans/2026-09-05-c-author-parity.md`
- Modify: none

**Interfaces:**
- Consumes: remote branch `feat/content-author-c`.
- Produces: a clean isolated worktree whose current branch is `feat/content-author-c`.

- [ ] **Step 1: Create or attach the isolated worktree**

Use `superpowers:using-git-worktrees`. Fetch without changing main:

```bash
git fetch origin main feat/content-author-c
git worktree list
```

If the branch is not already checked out elsewhere, create a dedicated worktree from the remote feature branch:

```bash
git worktree add ../leileios-content-author-c -b feat/content-author-c origin/feat/content-author-c
```

If the local branch already exists but is not checked out:

```bash
git worktree add ../leileios-content-author-c feat/content-author-c
```

Do not delete or repurpose any existing worktree.

- [ ] **Step 2: Verify branch, base, and scope**

Run in the new worktree:

```bash
git status --short
git branch --show-current
git merge-base HEAD origin/main
git log --oneline --decorate -5
```

Expected: clean status; branch `feat/content-author-c`; history contains design commit `d69d07cd9cc76fbc544f335d1a820cc20dbc2257`; merge-base is the approved main baseline unless main has advanced.

- [ ] **Step 3: Run one controlled runner preflight**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/paper-author-signature.test.ts
```

Expected: the existing L/G test passes. If `tsx` fails while opening an IPC pipe/socket with `EPERM` or `EINVAL`, stop immediately and report the exact environment failure; make no code edits.

---

### Task 1: Shared C Vocabulary and Forward-Only PostgreSQL Migration

**Files:**
- Create: `tests/content-author-c-migration.test.ts`
- Modify: `src/domains/content-author.ts`
- Modify: `src/database/schema.ts`
- Create: next migration after the verified migration head, expected `drizzle/0032_content_author_c.sql`
- Modify: generated metadata under `drizzle/meta/`

**Interfaces:**
- Produces:
```ts
export const CONTENT_AUTHORS = ["L", "G", "C"] as const;
export type ContentAuthor = "L" | "G" | "C";
export function isContentAuthor(value: unknown): value is ContentAuthor;
```
- Database contract: `content_author = 'L' | 'G' | 'C'`.

- [ ] **Step 1: Write the failing vocabulary/migration test**

Create `tests/content-author-c-migration.test.ts` with assertions equivalent to:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CONTENT_AUTHORS, isContentAuthor } from "../src/domains/content-author.js";

test("content author vocabulary includes exactly L G C", () => {
  assert.deepEqual(CONTENT_AUTHORS, ["L", "G", "C"]);
  assert.equal(isContentAuthor("L"), true);
  assert.equal(isContentAuthor("G"), true);
  assert.equal(isContentAuthor("C"), true);
  assert.equal(isContentAuthor("Claude"), false);
  assert.equal(isContentAuthor(null), false);
});

test("C author migration is additive and does not rewrite business rows", () => {
  const migration = readFileSync("drizzle/0032_content_author_c.sql", "utf8");
  assert.match(migration, /ALTER TYPE\s+"public"\."content_author"\s+ADD VALUE(?: IF NOT EXISTS)?\s+'C'/i);
  assert.doesNotMatch(migration, /\bUPDATE\b/i);
  assert.doesNotMatch(migration, /\bDELETE\b/i);
  assert.doesNotMatch(migration, /\bDROP\b/i);
});
```

If the verified next migration number is not 0032, use that exact filename in both the test and implementation.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/content-author-c-migration.test.ts
```

Expected: FAIL because `CONTENT_AUTHORS` lacks C and the migration file is absent.

- [ ] **Step 3: Extend the shared runtime vocabulary**

Change `src/domains/content-author.ts` to:

```ts
export const CONTENT_AUTHORS = ["L", "G", "C"] as const;

export type ContentAuthor = (typeof CONTENT_AUTHORS)[number];

export function isContentAuthor(value: unknown): value is ContentAuthor {
  return value === "L" || value === "G" || value === "C";
}
```

Change the Drizzle declaration in `src/database/schema.ts` from `["L", "G"]` to `["L", "G", "C"]`.

- [ ] **Step 4: Generate and normalize the migration**

```bash
pnpm exec drizzle-kit generate --name content_author_c
```

Keep only the expected enum alteration and generated metadata. The SQL must be equivalent to:

```sql
ALTER TYPE "public"."content_author" ADD VALUE IF NOT EXISTS 'C';
```

Reject unrelated schema churn. Normalize the generated filename and the newly appended journal tag to `0032_content_author_c` when 0031 is still the verified head.

- [ ] **Step 5: Run GREEN and schema checks**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/content-author-c-migration.test.ts   tests/author-schema-migration.test.ts   tests/todo-schema-migration.test.ts
pnpm db:check
git diff --check
```

Expected: PASS; no business-row mutation appears in the migration.

- [ ] **Step 6: Commit**

```bash
git add src/domains/content-author.ts src/database/schema.ts drizzle   tests/content-author-c-migration.test.ts tests/author-schema-migration.test.ts   tests/todo-schema-migration.test.ts
git commit -m "feat: add C content author vocabulary"
```

---

### Task 2: Memory Backend, Web API, and MCP C Parity

**Files:**
- Modify the Memory files and tests listed in the File Structure Map.

**Interfaces:**
- Consumes: `ContentAuthor = "L" | "G" | "C"`.
- Produces: Memory API/MCP reads with `author: ContentAuthor | null`; creates and content updates that accept C.

- [ ] **Step 1: Add RED cases**

Add explicit C cases to the named tests:

```ts
assert.equal(created.author, "C");
assert.equal(read.author, "C");
assert.equal(updated.author, "C");
```

In MCP schema tests, invoke create/update with `author: "C"` and assert the structured response preserves C. Keep one invalid case:

```ts
author: "Claude"
```

Expected: rejected without repository mutation.

Add lifecycle coverage proving archive/restore/permanent-delete request builders never synthesize or change author.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/memory-detail-service.test.ts   tests/memory-repository-update-contract.test.ts   tests/memory-lifecycle-repository.integration.test.ts   tests/web-memory-api.test.ts   tests/write-memory-tool.test.ts   tests/memory-mcp-write.test.ts   tests/memory-read-tools.test.ts
```

Expected: at least one C case fails at a closed L/G schema or serializer.

- [ ] **Step 3: Replace closed Memory author schemas**

Where Memory tools or routers contain a local schema, define it from the exact accepted values:

```ts
const contentAuthorSchema = z.enum(["L", "G", "C"]);
```

Use the shared `ContentAuthor` type in domain/repository signatures. Preserve:

```ts
author: ContentAuthor | null
```

for reads, and non-null `ContentAuthor` for creates. Do not infer C from source or caller.

- [ ] **Step 4: Preserve edit and lifecycle semantics**

Keep the current legacy-null gate and expand only what `isContentAuthor` accepts:

```ts
const author = input.author ?? existing.author ?? null;
this.requireAuthor(author);
```

The existing `requireAuthor` method continues to throw `MemoryDomainError("AUTHOR_REQUIRED", "A content author must be selected.")` for null or invalid values. Allow explicit L↔G↔C changes on content edits. Keep author absent from archive/restore/permanent-delete inputs and persistence updates.

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/memory-detail-service.test.ts   tests/memory-repository-update-contract.test.ts   tests/memory-lifecycle-repository.integration.test.ts   tests/web-memory-api.test.ts   tests/write-memory-tool.test.ts   tests/memory-mcp-write.test.ts   tests/memory-read-tools.test.ts
pnpm typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add src/domains/memory src/web-api/memory-router.ts   src/mcp/tools/write-memory/register.ts   src/mcp/tools/update-memory/register.ts   src/mcp/tools/get-memory/register.ts   src/mcp/tools/read-memory/register.ts   src/mcp/tools/search-memory/register.ts   tests/memory-detail-service.test.ts   tests/memory-repository-update-contract.test.ts   tests/memory-lifecycle-repository.integration.test.ts   tests/web-memory-api.test.ts tests/write-memory-tool.test.ts   tests/memory-mcp-write.test.ts tests/memory-read-tools.test.ts
git commit -m "feat: support C author in memory"
```

---

### Task 3: Diary Backend, Web API, and MCP C Parity

**Files:**
- Modify the Diary files and tests listed in the File Structure Map.

**Interfaces:**
- Consumes: shared `ContentAuthor`.
- Produces: Diary API/MCP create, update, get, search, and read shapes that preserve C.

- [ ] **Step 1: Add Diary RED cases**

Add C create, read, content edit, and author reassignment cases:

```ts
const input = {
  title: "Claude diary",
  content: "A C-authored entry.",
  date: "2026-09-05",
  tags: [],
  author: "C" as const,
};
```

Assert idempotent replay returns the same C entry. Assert the same idempotency key with identical content but author G conflicts. Add `author: "Claude"` as an invalid no-mutation case.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/diary-service.test.ts   tests/diary-repository.integration.test.ts   tests/diary-api.test.ts   tests/diary-lifecycle.test.ts   tests/write-diary-tool.test.ts   tests/diary-read-tools.test.ts   tests/mcp-diary-error-contract.test.ts
```

- [ ] **Step 3: Extend Diary runtime schemas and serializers**

Use:

```ts
const contentAuthorSchema = z.enum(["L", "G", "C"]);
```

for every Diary MCP input/output schema that currently closes over L/G. Thread the shared type through service/repository/router code and preserve nullable legacy reads.

Update user-facing schema descriptions from “L or G” to “L, G, or C” where present. Do not change tool names or annotations.

- [ ] **Step 4: Preserve Diary invariants**

Keep author in the canonical idempotency input:

```ts
{
  title: normalized.title,
  content: normalized.content,
  date: normalized.date,
  tags: normalized.tags,
  mood: normalized.mood,
  author: normalized.author,
}
```

Archive, restore, and permanent delete do not accept author. Content update may explicitly select C and continues to reject a legacy-null edit with no author.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/diary-service.test.ts   tests/diary-repository.integration.test.ts   tests/diary-api.test.ts   tests/diary-lifecycle.test.ts   tests/write-diary-tool.test.ts   tests/diary-read-tools.test.ts   tests/mcp-diary-error-contract.test.ts
pnpm typecheck
git diff --check
git add src/domains/diary src/web-api/diary-router.ts   src/mcp/tools/write-diary/register.ts   src/mcp/tools/update-diary/register.ts   src/mcp/tools/get-diary/register.ts   src/mcp/tools/search-diary/register.ts   tests/diary-service.test.ts tests/diary-repository.integration.test.ts   tests/diary-api.test.ts tests/diary-lifecycle.test.ts   tests/write-diary-tool.test.ts tests/diary-read-tools.test.ts   tests/mcp-diary-error-contract.test.ts
git commit -m "feat: support C author in diary"
```

---

### Task 4: Task Backend, Web API, and MCP C Parity

**Files:**
- Modify the Task files and tests listed in the File Structure Map.

**Interfaces:**
- Consumes: shared `ContentAuthor`.
- Produces: Task create/update/read support for C while status transitions remain author-independent.

- [ ] **Step 1: Add Task RED cases**

Add C create, get/list, content update, and C↔L/G reassignment assertions. For each start/complete/cancel/reopen path, seed a C task and assert after repository re-read:

```ts
assert.equal(reloaded.author, "C");
```

Assert status requests contain no `author` property.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/task-service.test.ts   tests/task-api.test.ts   tests/task-lifecycle-repository.integration.test.ts   tests/task-status-reopen.integration.test.ts   tests/create-task-tool.test.ts   tests/task-read-tools.test.ts   tests/task-web-actions.test.ts
```

- [ ] **Step 3: Extend Task author schemas**

Use `z.enum(["L", "G", "C"])` in create/update/read MCP schemas and the shared `ContentAuthor` in domain/repository/API signatures.

Keep status-only inputs unchanged. Audit each status SQL update so its `.set(...)` object contains status/timestamps only and never author.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/task-service.test.ts   tests/task-api.test.ts   tests/task-lifecycle-repository.integration.test.ts   tests/task-status-reopen.integration.test.ts   tests/create-task-tool.test.ts   tests/task-read-tools.test.ts   tests/task-web-actions.test.ts
pnpm typecheck
git diff --check
git add src/domains/task src/web-api/task-router.ts   src/mcp/tools/create-task/register.ts   src/mcp/tools/update-task/register.ts   src/mcp/tools/get-task/register.ts   src/mcp/tools/list-tasks/register.ts   src/mcp/tools/transition-task/register.ts   tests/task-service.test.ts tests/task-api.test.ts   tests/task-lifecycle-repository.integration.test.ts   tests/task-status-reopen.integration.test.ts   tests/create-task-tool.test.ts tests/task-read-tools.test.ts   tests/task-web-actions.test.ts
git commit -m "feat: support C author in tasks"
```

Before `git add`, omit `transition-task/register.ts` if inspection proved it required no change.

---

### Task 5: Todo Three-Paper Backend, Web API, and MCP Contract

**Files:**
- Modify the Todo backend/MCP files and tests listed in the File Structure Map.

**Interfaces:**
- Produces:
```ts
export type TodoDayPapers = {
  L: TodoPaper | null;
  G: TodoPaper | null;
  C: TodoPaper | null;
};
```
- Web/MCP JSON: `papers: { L, G, C }`.

- [ ] **Step 1: Add Todo RED fixtures**

Replace two-slot fixtures with explicit three-slot fixtures:

```ts
const PAPERS: TodoDayPapers = {
  L: null,
  G: null,
  C: {
    author: "C",
    date: "2026-09-05",
    revision: 1,
    entries: [{ id: "c-1", kind: "pending", text: "Claude item" }],
  },
};
```

Add assertions for:

- empty DB day returns `{ L: null, G: null, C: null }`;
- a C row hydrates only the C slot;
- saving C increments only C revision;
- C write/read API round trip;
- C idempotent replay;
- same key with G versus C conflicts;
- invalid `Claude` author fails without mutation.

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/todo-service.test.ts   tests/todo-repository.integration.test.ts   tests/todo-api.test.ts   tests/todo-mcp-tools.test.ts
```

- [ ] **Step 3: Extend Todo types and repository hydration**

Change `src/domains/todo/todo-types.ts`:

```ts
export type TodoDayPapers = {
  L: TodoPaper | null;
  G: TodoPaper | null;
  C: TodoPaper | null;
};
```

Replace closed repository row types such as:

```ts
row: { author: ContentAuthor; businessDate: string; revision: number }
```

Initialize each read with:

```ts
const papers: TodoDayPapers = { L: null, G: null, C: null };
```

Assign by validated `row.author`. Never coerce an unrecognized database value.

- [ ] **Step 4: Extend Todo MCP schemas and copy**

Use:

```ts
const todoAuthorSchema = z.enum(["L", "G", "C"]);
```

for paper schemas and write inputs. Change `read_todo_day` output to:

```ts
papers: z.object({
  L: todoPaperSchema.nullable(),
  G: todoPaperSchema.nullable(),
  C: todoPaperSchema.nullable(),
})
```

Update tool descriptions to say “L, G, and C”. Keep the complete-paper destructive hint, revision contract, and idempotency behavior unchanged.

- [ ] **Step 5: Run GREEN and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/todo-service.test.ts   tests/todo-repository.integration.test.ts   tests/todo-api.test.ts   tests/todo-mcp-tools.test.ts
pnpm typecheck
git diff --check
git add src/domains/todo src/web-api/todo-router.ts   src/mcp/tools/read-todo-day/register.ts   src/mcp/tools/list-todo-dates/register.ts   src/mcp/tools/write-todo-paper/register.ts   tests/todo-service.test.ts tests/todo-repository.integration.test.ts   tests/todo-api.test.ts tests/todo-mcp-tools.test.ts
git commit -m "feat: add C Todo paper contract"
```

---

### Task 6: Shared Web Author Signature and Memory/Diary/Task UI

**Files:**
- Modify the shared author and content-module Web files/tests listed in the File Structure Map.

**Interfaces:**
- Produces:
```ts
export type PaperAuthorValue = "L" | "G" | "C" | null;

export interface PaperAuthorSignatureProps {
  value: PaperAuthorValue;
  editable: boolean;
  disabled?: boolean;
  onChange?: (author: Exclude<PaperAuthorValue, null>) => void;
  error?: string | null;
}
```

- [ ] **Step 1: Add shared component RED assertions**

In `tests/paper-author-signature.test.ts`, assert the editable menu contains exactly L, G, C in order and read-only C displays C:

```ts
assert.deepEqual(
  [...container.querySelectorAll("[data-author]")].map((node) => node.getAttribute("data-author")),
  ["L", "G", "C"],
);
```

Keep a null `—` assertion and verify there is no localStorage/sessionStorage/default-author/source inference.

- [ ] **Step 2: Add module RED cases**

For Memory, Diary, and Task:

- create begins at null and blocks save;
- selecting C enables a valid content save;
- a C record renders C;
- edit starts at C and may change to L or G;
- changing author marks dirty;
- cancel restores the stored C value;
- archive/restore/status payloads contain no author.

- [ ] **Step 3: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/paper-author-signature.test.ts   tests/memory-page.test.ts tests/memory-paper-editor.test.ts   tests/diary-page.test.ts tests/diary-paper-editor.test.ts   tests/task-detail-view.test.ts tests/task-submission-gate.test.ts   tests/quick-create.test.ts tests/web-unsaved-changes.test.ts
```

- [ ] **Step 4: Implement the shared C menu**

In `PaperAuthorSignature.tsx`, replace the two-author local union and loop with:

```ts
export type PaperAuthorValue = "L" | "G" | "C" | null;
export type PaperAuthor = Exclude<PaperAuthorValue, null>;

const PAPER_AUTHORS: readonly PaperAuthor[] = ["L", "G", "C"];
```

Render the menu from `PAPER_AUTHORS`. Preserve keyboard behavior, focus restoration, disabled state, inline error presentation, and read-only null rendering.

- [ ] **Step 5: Thread C through content-module Web state**

Update local request/record types and author state to `PaperAuthorValue`. Create remains `null`; edit copies the durable record author. Continue to block with:

```ts
if (draft.author === null) {
  setInlineError("请选择作者");
  return;
}
```

Send the chosen C exactly. Do not select C based on Claude or current host.

- [ ] **Step 6: Run GREEN, build, and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/paper-author-signature.test.ts   tests/memory-page.test.ts tests/memory-paper-editor.test.ts   tests/diary-page.test.ts tests/diary-paper-editor.test.ts   tests/task-detail-view.test.ts tests/task-submission-gate.test.ts   tests/quick-create.test.ts tests/web-unsaved-changes.test.ts
pnpm --dir web run typecheck
pnpm --dir web run build
git diff --check
git add web/src/pages/PaperAuthorSignature.tsx   web/src/pages/MemoryPage.tsx web/src/pages/MemoryPaperEditor.tsx   web/src/pages/DiaryPage.tsx web/src/pages/DiaryPaperEditor.tsx   web/src/pages/TaskPage.tsx web/src/pages/TaskPaperEditor.tsx   tests/paper-author-signature.test.ts   tests/memory-page.test.ts tests/memory-paper-editor.test.ts   tests/diary-page.test.ts tests/diary-paper-editor.test.ts   tests/task-detail-view.test.ts tests/task-submission-gate.test.ts   tests/quick-create.test.ts tests/web-unsaved-changes.test.ts
git commit -m "feat: add C author to paper flows"
```

---

### Task 7: Home C Todo Paper

**Files:**
- Modify the Todo Web/Home files and tests listed in the File Structure Map.

**Interfaces:**
- Consumes: `TodoAuthor = "L" | "G" | "C"` and three-slot `TodoDay`.
- Produces: a third Home Todo panel, ordered L → G → C.

- [ ] **Step 1: Add Home RED tests**

Assert the Home render contains three author panels in order, C opens its own dialog, and saving C updates only `papers.C`.

Add date-rollover coverage where a dirty C dialog defers the day switch and a clean close applies it.

Add an API fixture:

```ts
{
  date: "2026-09-05",
  papers: { L: null, G: null, C: null },
}
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/todo-paper-dialog.test.ts   tests/todo-paper-dialog-server.test.ts   tests/todo-paper-storage.test.ts   tests/todo-legacy-migration.test.ts   tests/todo-home-api.test.ts   tests/todo-home-date-rollover.test.ts   tests/mobile-home-shell.test.ts
```

- [ ] **Step 3: Extend Todo Web types and helpers**

Change:

```ts
export type TodoAuthor = "L" | "G" | "C";
export type TodoDay = {
  date: string;
  papers: {
    L: TodoPaper | null;
    G: TodoPaper | null;
    C: TodoPaper | null;
  };
};
```

Update storage keys/migration helpers only where they enumerate authors. Legacy L/G localStorage migration remains unchanged for existing keys; no fabricated legacy C key is required. New C persistence uses the server path.

- [ ] **Step 4: Add the C panel without duplicating dialog logic**

In `DashboardPage.tsx`, initialize:

```ts
const [papers, setPapers] = useState<TodoDay["papers"]>({
  L: null,
  G: null,
  C: null,
});
```

Use a ref map or three explicit refs. Render:

```tsx
<TodayPanel
  author="L"
  notes={loadState === "ready" ? papers.L?.entries ?? [] : []}
  triggerRef={lTriggerRef}
  onOpen={() => setDialogAuthor("L")}
/>
<TodayPanel
  author="G"
  notes={loadState === "ready" ? papers.G?.entries ?? [] : []}
  triggerRef={gTriggerRef}
  onOpen={() => setDialogAuthor("G")}
/>
<TodayPanel
  author="C"
  notes={loadState === "ready" ? papers.C?.entries ?? [] : []}
  triggerRef={cTriggerRef}
  onOpen={() => setDialogAuthor("C")}
/>
```

Select the matching trigger for all three authors. Keep a single `TodoPaperDialog`; do not fork a Claude-specific dialog.

- [ ] **Step 5: Make only necessary responsive CSS changes**

At mobile and desktop widths, preserve readable paper width and vertical rhythm with three panels. Do not change Calendar, Records navigation, page title, or overall visual system.

- [ ] **Step 6: Run GREEN, build, and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/todo-paper-dialog.test.ts   tests/todo-paper-dialog-server.test.ts   tests/todo-paper-storage.test.ts   tests/todo-legacy-migration.test.ts   tests/todo-home-api.test.ts   tests/todo-home-date-rollover.test.ts   tests/mobile-home-shell.test.ts
pnpm --dir web run typecheck
pnpm --dir web run build
git diff --check
git add web/src/pages/todo-types.ts web/src/pages/todo-api.ts   web/src/pages/todo-paper-storage.ts web/src/pages/todo-legacy-migration.ts   web/src/pages/TodoPaperDialog.tsx web/src/pages/TodoPaperEditor.tsx   web/src/pages/DashboardPage.tsx web/src/styles.css   tests/todo-paper-dialog.test.ts tests/todo-paper-dialog-server.test.ts   tests/todo-paper-storage.test.ts tests/todo-legacy-migration.test.ts   tests/todo-home-api.test.ts tests/todo-home-date-rollover.test.ts   tests/mobile-home-shell.test.ts
git commit -m "feat: add C Todo paper to home"
```

Omit unchanged files from `git add`.

---

### Task 8: Day Space C Todo and C Diary Parity

**Files:**
- Modify the Day Space files and tests listed in the File Structure Map.

**Interfaces:**
- Consumes: three-slot `TodoDay` and `PaperAuthorValue = L | G | C | null`.
- Produces: stable C Todo card ID `todo:<date>:C` and C-capable Diary editing.

- [ ] **Step 1: Add Day Space RED composition tests**

Use:

```ts
const day = {
  date: "2026-09-05",
  papers: {
    L: null,
    G: null,
    C: {
      author: "C" as const,
      date: "2026-09-05",
      revision: 2,
      entries: [{ id: "c-1", kind: "pending" as const, text: "C paper" }],
    },
  },
};
```

Assert composition returns `id === "todo:2026-09-05:C"`. Add a second case where C exists with `entries: []` and produces no card.

- [ ] **Step 2: Add Day Space interaction RED cases**

Assert:

- C Todo opens the existing Todo dialog;
- successful C save updates the C slot;
- failed post-save reload preserves committed C and marks Todo retry;
- complete-empty becomes true only after all three Todo slots are empty and Diary is empty;
- Diary author C renders and remains selected;
- Diary may be explicitly changed from C to G and preserves date/tags/mood.

- [ ] **Step 3: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/day-space-data.test.ts   tests/day-space-diary-author-signature.test.ts   tests/day-space-real-data.test.ts   tests/day-space-mobile-page.test.ts   tests/day-space-layout.test.ts
```

- [ ] **Step 4: Extend Todo composition and recovery**

In `day-space-data.ts`, iterate exactly:

```ts
const TODO_AUTHORS = ["L", "G", "C"] as const;
```

Keep stable IDs:

```ts
`todo:${date}:${paper.author}`
```

In `DaySpacePage.tsx`, ensure a missing local Todo state created after a failed refresh has all three slots:

```ts
{
  date,
  papers: {
    L: committed.author === "L" ? committed : null,
    G: committed.author === "G" ? committed : null,
    C: committed.author === "C" ? committed : null,
  },
}
```

For an existing state, computed assignment by `committed.author` must accept C.

- [ ] **Step 5: Preserve Diary semantics**

Use the expanded `PaperAuthorValue` in `day-space-api.ts` and `DaySpaceDiaryDialog.tsx`. Do not change the Diary date in Day Space. Keep loaded tags and mood in the update request.

- [ ] **Step 6: Run GREEN, build, and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/day-space-data.test.ts   tests/day-space-diary-author-signature.test.ts   tests/day-space-real-data.test.ts   tests/day-space-mobile-page.test.ts   tests/day-space-layout.test.ts
pnpm --dir web run typecheck
pnpm --dir web run build
git diff --check
git add web/src/pages/DaySpacePage.tsx   web/src/pages/DaySpaceDiaryDialog.tsx   web/src/pages/day-space-api.ts web/src/pages/day-space-data.ts   tests/day-space-data.test.ts   tests/day-space-diary-author-signature.test.ts   tests/day-space-real-data.test.ts   tests/day-space-mobile-page.test.ts tests/day-space-layout.test.ts
git commit -m "feat: support C author in Day Space"
```

---

### Task 9: Import, Export, and Global Search Preservation

**Files:**
- Inspect and modify only closed author contracts in the import/export/search files listed in the File Structure Map.

**Interfaces:**
- Consumes: `ContentAuthor = L | G | C`.
- Produces: C-preserving export, import, and search serialization; no author filter.

- [ ] **Step 1: Add RED export tests**

Seed Memory, Diary, Task, and Todo records with C. Assert the exported canonical payload contains `author: "C"` for each author-bearing record and does not replace or omit it.

- [ ] **Step 2: Add RED import tests**

Pass a canonical import payload with C-authored records through schema validation, planning, and persistence. Assert C is accepted and stored. Keep `author: "Claude"` as a rejected invalid payload.

- [ ] **Step 3: Add RED Global Search tests**

Seed a C-authored searchable Memory, Diary, or Task and assert repository/service/API/Web result author remains C. Assert no request parameter or UI control for author filtering was added.

- [ ] **Step 4: Run RED**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/export-service.test.ts tests/export-api.test.ts   tests/export-repository.integration.test.ts   tests/import-schema.test.ts tests/import-planner.test.ts   tests/import-service.test.ts tests/import-api.test.ts   tests/import-repository.integration.test.ts   tests/global-search.test.ts tests/global-search-api.test.ts   tests/global-search-repository.integration.test.ts   tests/global-search-web.test.ts
```

- [ ] **Step 5: Replace closed unions without adding new behavior**

Use shared `ContentAuthor` in backend canonical types. In Web-only schemas that cannot import backend code, use:

```ts
type ContentAuthor = "L" | "G" | "C";
```

or the existing Web shared author type. Validators accept exactly those three values. Serializers return the stored author unchanged. Do not add provenance mapping or an author filter.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm exec tsx --test --test-concurrency=1   tests/export-service.test.ts tests/export-api.test.ts   tests/export-repository.integration.test.ts   tests/import-schema.test.ts tests/import-planner.test.ts   tests/import-service.test.ts tests/import-api.test.ts   tests/import-repository.integration.test.ts   tests/global-search.test.ts tests/global-search-api.test.ts   tests/global-search-repository.integration.test.ts   tests/global-search-web.test.ts
pnpm typecheck
pnpm --dir web run typecheck
git diff --check
git add src/domains/export src/domains/import src/domains/global-search   src/web-api/export-router.ts src/web-api/import-router.ts   src/web-api/global-search-router.ts   web/src/system/export-types.ts web/src/system/import-types.ts   web/src/pages/global-search-result.ts   tests/export-service.test.ts tests/export-api.test.ts   tests/export-repository.integration.test.ts   tests/import-schema.test.ts tests/import-planner.test.ts   tests/import-service.test.ts tests/import-api.test.ts   tests/import-repository.integration.test.ts   tests/global-search.test.ts tests/global-search-api.test.ts   tests/global-search-repository.integration.test.ts   tests/global-search-web.test.ts
git commit -m "feat: preserve C author across data surfaces"
```

Before staging, use `git diff --name-only` and omit every unchanged file.

---

### Task 10: Repository-Wide Closed-Author Audit

**Files:**
- Modify only files proven by the audit to contain a product-relevant closed L/G assumption.
- Test: existing contract test nearest each changed file.

**Interfaces:**
- Produces: no remaining product path that rejects, drops, or mislabels C while accepting L/G.

- [ ] **Step 1: Run exact searches**

```bash
rg -n '\["L",\s*"G"\]|"L"\s*\|\s*"G"|\{\s*L:.*G:|\["L",\s*"G"\]\s+as const|L or G|L and G|L/G'   src web/src tests docs --glob '!docs/superpowers/plans/2026-08-10-lg-author-foundation.md'   --glob '!docs/superpowers/specs/2026-08-10-lg-author-foundation-design.md'
```

Classify every result as one of:

1. product contract that must accept C;
2. historical documentation that remains historically accurate;
3. test deliberately proving legacy migration behavior;
4. unrelated text.

- [ ] **Step 2: Fix product-contract findings with a focused RED/GREEN test**

For each product finding, first modify the nearest test so C fails, run only that test, make the smallest code/copy change, and rerun the same test.

Do not mechanically rewrite historical design documents or legacy-migration fixtures.

- [ ] **Step 3: Verify no closed product assumptions remain**

Run the same `rg` command. Remaining matches must be confined to historical documentation, explicit legacy compatibility tests, or explanatory migration history.

- [ ] **Step 4: Commit only actual fixes**

```bash
git diff --check
git status --short
git diff --name-only
```

Stage each literal path printed by `git diff --name-only`, review `git diff --cached`, then run:

```bash
git commit -m "test: close C author parity gaps"
```

If no additional files changed, do not create an empty commit.

---

### Task 11: Full Verification, Disposable Database, and Rollout Runbook

**Files:**
- Create: `docs/operations/c-author-parity-rollout.md`
- Modify product/test files only if a final verification failure exposes a real defect.

**Interfaces:**
- Produces: verified Draft-PR-ready branch and an explicit production runbook.
- Does not produce: a merge, deployment, or production mutation.

- [ ] **Step 1: Write the rollout runbook**

Create `docs/operations/c-author-parity-rollout.md` with this enforced sequence:

```text
1. Verify final branch SHA and actual migration head.
2. Confirm a current encrypted PostgreSQL backup and restore readiness.
3. Record pre-migration author counts for core_memories, diary_entries, tasks, and todo_papers.
4. Apply and verify only the additive content_author C migration.
5. Re-read counts and prove no existing author values changed.
6. Deploy the exact C-aware application SHA.
7. Verify /health and startup logs.
8. Verify legacy L, G, and null reads before any C write.
9. Verify ChatGPT and Claude both read MCP schemas/results containing L, G, and C.
10. Obtain explicit user authorization before the first production C write.
11. Smoke-test an approved C Memory/Diary/Task/Todo path and verify Home and Day Space.
12. Inspect safe Railway logs for OAuth, MCP, database, and validation failures.
```

Rollback section:

```text
Before any C record exists, application rollback is allowed; leave the additive enum value in place.
Never run a destructive production down migration.
After a C record exists, do not deploy an L/G-only application. Fix forward with a C-aware build.
```

- [ ] **Step 2: Run the complete deterministic suite once**

```bash
pnpm test
```

Record exact pass/fail/skip totals. On `tsx` IPC `EPERM`/`EINVAL`, stop and report; do not substitute GitHub checks for an unexecuted local suite without explicitly recording the limitation.

- [ ] **Step 3: Run Root and Web gates**

```bash
pnpm typecheck
pnpm build
pnpm --dir web run typecheck
pnpm --dir web run build
pnpm db:check
git diff --check
```

- [ ] **Step 4: Verify the full migration chain on disposable PostgreSQL**

Use only an isolated disposable database. Apply all migrations through the new C migration. Before and after the C migration, query:

```sql
SELECT author, count(*) FROM core_memories GROUP BY author ORDER BY author NULLS FIRST;
SELECT author, count(*) FROM diary_entries GROUP BY author ORDER BY author NULLS FIRST;
SELECT author, count(*) FROM tasks GROUP BY author ORDER BY author NULLS FIRST;
SELECT author, count(*) FROM todo_papers GROUP BY author ORDER BY author NULLS FIRST;
```

Insert and read back one disposable C row per author-bearing table through repository/service integration paths. Confirm the Todo uniqueness constraint permits one each of L/G/C for the same user/date and rejects a second C paper.

Do not point `DATABASE_URL` at production.

- [ ] **Step 5: Run focused database integration suites**

Use the repository's existing opt-in environment flags with the disposable database:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1   tests/memory-lifecycle-repository.integration.test.ts   tests/diary-repository.integration.test.ts   tests/task-lifecycle-repository.integration.test.ts   tests/todo-repository.integration.test.ts   tests/export-repository.integration.test.ts   tests/import-repository.integration.test.ts   tests/global-search-repository.integration.test.ts
```

If a named suite uses a more specific existing flag, inspect that test's guard and run it with the exact documented flag instead of disabling the guard.

- [ ] **Step 6: Run formal Security Scan**

Target the exact final commit. Require the report to inspect:

- migration safety;
- invalid-author fail-closed behavior;
- user isolation;
- MCP input/output schemas;
- idempotency;
- import validation;
- logging privacy;
- absence of OAuth/Auth0/Railway/secret changes.

Record coverage limitations such as unavailable TAC or delegated audit separately from findings.

- [ ] **Step 7: Final scope and branch checks**

```bash
git status --short
git diff --check
git diff --name-only 090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76...HEAD
git log --oneline --decorate 090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76..HEAD
```

Reject changes to Auth0, OAuth, Railway configuration, Bridge, Sentinel, secrets, or PR #278's System Connections label.

- [ ] **Step 8: Commit the runbook and any proven final correction**

```bash
git add docs/operations/c-author-parity-rollout.md
git commit -m "docs: add C author rollout runbook"
```

If verification required a code/test fix, commit that fix separately with a message naming the defect; rerun the affected focused test and all final gates before proceeding.

- [ ] **Step 9: Push and open a Draft PR only**

```bash
git push -u origin feat/content-author-c
```

Open a Draft PR targeting `main`. The PR description must include:

The PR description must state these exact fixed values:

```text
BASE_SHA=090eeb2871c37fb3f9f6ca31fc482fcd9aaf5e76
DESIGN_SPEC=docs/superpowers/specs/2026-09-05-c-author-parity-design.md
MIGRATION_HEAD=0032_content_author_c.sql
LEGACY_DATA_CHANGED=NO
MCP_TOOL_COUNT_CHANGED=NO
PR_278_INCLUDED=NO
PRODUCTION_TOUCHED=NO
```

It must also include the measured full-suite pass/fail/skip totals, PASS or the exact blocker for each Root/Web typecheck/build and DB check, disposable PostgreSQL evidence, and Security Scan findings plus coverage. If Task 1 proves the migration head is not 0032, replace the fixed migration line with the actual committed filename before opening the PR.

Stop at Draft/Open. Do not Ready, merge, deploy, refresh connectors, run the production migration, or write production C content.

---

## Final Handoff Required From Codex

Report:

- feature branch and isolated worktree path;
- final commit SHA and approved base SHA;
- Draft PR URL;
- exact changed-file list;
- migration SQL summary and verified migration head;
- focused RED/GREEN commands and results for every task;
- complete suite totals and skipped-test reasons;
- Root/Web build and typecheck results;
- disposable PostgreSQL migration evidence and author counts;
- MCP tool-count comparison;
- Security Scan findings and coverage limitations;
- proof that legacy data, #278, production, Railway, Auth0, OAuth, Bridge, Sentinel, and secrets were not modified;
- remaining risks and the exact next authorization boundary.
