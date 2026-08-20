# ChatGPT Resource Updates Implementation Plan

> **For Codex:** Execute this file task-by-task with `superpowers:executing-plans`. For every behavior change, use `superpowers:test-driven-development`. Before completion, use `superpowers:verification-before-completion`.

**Base:** `b8e551307d22ee91914b6182e3ea5c956111307b`

**Branch:** `feature/mcp-resource-updates`

**Goal:** Add safe ChatGPT/MCP updates for Memory, Diary, and Task, plus explicit Task state actions.

## Frozen contract

Add exactly four MCP tools:

- `update_memory`
- `update_diary`
- `update_task`
- `transition_task`

All four tools:

- use `id: z.string().trim().min(1)` to match existing `get_memory`, `get_diary`, and `get_task` ID contracts;
- use strict Zod objects;
- never accept `user_id`, `userId`, or `idempotency_key`;
- use annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`;
- never blindly retry after an uncertain mutation outcome; read the target back first.

`update_memory` mutable fields:

- `category`: `profile | preference | goal | project`
- `key`: string
- `content`: string
- `tags`: string[]
- `author`: `L | G`

`update_diary` mutable fields:

- `title`: string
- `content`: string
- `date`: `YYYY-MM-DD`
- `tags`: string[]
- `mood`: string | null
- `author`: `L | G`

`update_task` mutable fields:

- `title`: string
- `description`: string
- `priority`: `low | normal | high | urgent`
- `due_time`: `null`, an ISO instant accepted by `Temporal.Instant.from`, or a local date-time matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$` and interpreted in the account timezone
- `tags`: string[]
- `author`: `L | G`

The MCP Zod field for `due_time` is exactly `z.string().trim().min(1).max(64).nullable().optional()`; domain parsing remains authoritative.

`update_task` must not expose `status`, `resumeStatus`, `completedAt`, or `timezone`. Task timezone remains account-owned; this PR does not add an MCP task-timezone mutation.

Partial-patch semantics for all `update_*` tools:

- omitted field = unchanged;
- `tags: []` = clear tags;
- `mood: null` = clear Diary mood;
- `due_time: null` = clear Task due time;
- no other mutable field accepts `null`;
- at least one mutable field is required.

`transition_task` input is exactly:

```ts
{
  id: string;
  action: "start" | "complete" | "cancel" | "reopen";
}
```

Task actions must reuse the existing state semantics:

- `start` -> existing transition to `in_progress`;
- `complete` -> existing transition to `completed`;
- `cancel` -> existing transition to `cancelled`;
- `reopen` -> existing `reopenTask`, preserving stored `resumeStatus`.

Repository mutation rule:

- service code validates only supplied fields;
- service code must not read a record, merge omitted values, then issue a full update;
- repository write transactions keep the existing active-user guard and active lifecycle predicate;
- repository `.set()` includes only supplied mutable columns plus `updatedAt`;
- successful MCP mutations return a fresh authoritative active readback.

Do not add UI changes, database migrations, archive/restore/delete MCP tools, generic Page/Universe mutations, bulk/silent synchronization, production database acceptance writes, or unrelated refactors.

---

## Task 1 — Memory partial update

**Modify**

- `src/domains/memory/memory-service.ts`
- `src/domains/memory/memory-repository.ts`
- `tests/memory-detail-service.test.ts`
- `tests/memory-repository-update-contract.test.ts`
- `tests/memory-lifecycle-repository.integration.test.ts`

### 1. RED tests

Add service tests proving:

1. content-only patch sends only `content` to repository mutation;
2. omitted `key/category/tags/author` are not reconstructed from a pre-read;
3. `tags: []` is preserved as an explicit patch value;
4. supplied `category/key/content/tags/author` reuse current Memory validation;
5. empty patch throws new `MemoryDomainError("INVALID_MEMORY_PATCH", ...)`;
6. missing/archived target returns `MEMORY_NOT_FOUND` through the active mutation path.

Update `tests/memory-repository-update-contract.test.ts` so it asserts `updateMemory` conditionally sets each mutable field by `!== undefined`/property presence and does not use truthiness for `tags`.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts
```

Expected: new tests fail for missing partial-update behavior.

### 2. Implement

In `memory-service.ts` add exactly:

```ts
export type UpdateMcpMemoryInput = {
  id: string;
  category?: MemoryCategory;
  key?: string;
  content?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

async updateMcpMemory(
  context: AuthenticatedMemoryContext,
  input: UpdateMcpMemoryInput,
): Promise<ReadMemoryDetailResult>
```

Add `INVALID_MEMORY_PATCH` to `MemoryDomainErrorCode`.

`updateMcpMemory` must:

1. call existing active-user validation;
2. trim/validate `id` as existing detail reads do;
3. reject zero supplied mutable fields;
4. normalize only supplied fields with existing Memory validators;
5. call repository `updateMemory` with `{ userId, id, ...suppliedNormalizedPatch }` only;
6. throw `MEMORY_NOT_FOUND` when repository returns false;
7. return `readMemoryDetail({ userId, id })` after the write.

Do not pre-read the Memory to fill omitted fields.

In `memory-repository.ts`, change repository `UpdateMemoryInput` so `key/category/content/tags/author` are optional. Keep `updateMemory` as the single repository update method. Build `.set()` from properties whose value is not `undefined`, then add `updatedAt: new Date()`.

The transaction must retain:

```ts
requireActiveUserInTransaction(...)
coreMemories.id === input.id
coreMemories.userId === input.userId
coreMemories.status === "active"
coreMemories.visibility === "assistant"
```

Do not change create/idempotency/lifecycle methods.

### 3. GREEN

Run the same focused command. Then, with a configured test database, run:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-lifecycle-repository.integration.test.ts
```

Add one integration assertion that a one-field `updateMemory` preserves unrelated stored fields and that `tags: []` clears tags.

Commit:

```bash
git add src/domains/memory/memory-service.ts src/domains/memory/memory-repository.ts \
  tests/memory-detail-service.test.ts tests/memory-repository-update-contract.test.ts \
  tests/memory-lifecycle-repository.integration.test.ts
git commit -m "feat: add safe Memory partial updates"
```

---

## Task 2 — Diary partial update

**Modify**

- `src/domains/diary/diary-service.ts`
- `src/domains/diary/diary-repository.ts`
- `tests/diary-service.test.ts`
- `tests/diary-repository.integration.test.ts`

### 1. RED tests

Add service tests proving:

1. a one-field patch sends only that field to repository mutation;
2. omitted fields are not reconstructed;
3. `tags: []` clears tags;
4. `mood: null` is preserved and clears mood;
5. omitted mood is absent from repository input;
6. supplied fields reuse current title/content/date/tags/mood/author validation;
7. empty patch throws new `DiaryDomainError("INVALID_DIARY_PATCH", ...)`;
8. archived/missing target returns `DIARY_NOT_FOUND` through the active path.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/diary-service.test.ts
```

Expected: new tests fail.

### 2. Implement

In `diary-service.ts` add exactly:

```ts
export type UpdateMcpDiaryInput = {
  id: string;
  title?: string;
  content?: string;
  date?: string;
  tags?: readonly string[];
  mood?: string | null;
  author?: ContentAuthor;
};

async updateMcpDiary(
  context: AuthenticatedDiaryContext,
  input: UpdateMcpDiaryInput,
): Promise<DiaryEntryResult>
```

Add `INVALID_DIARY_PATCH` to `DiaryDomainErrorCode`.

`updateMcpDiary` must validate only supplied fields. Extract field-level helpers from existing `normalizeDiaryFields`; `updateWebDiary` keeps its current full-update behavior.

Call repository `updateDiary` with only normalized supplied fields plus `userId/id`. Do not pre-read to fill omitted fields. After success, return `readDiary({ userId, id })`.

In `diary-repository.ts`, change `UpdateDiaryInput` so `title/content/date/tags/mood/author` are optional. `updateDiary` must build `.set()` from property presence, not truthiness, then add `updatedAt`.

Retain the existing transaction-scoped active-user guard and active Diary lifecycle predicate.

### 3. GREEN

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/diary-service.test.ts
```

With a configured test database, run:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/diary-repository.integration.test.ts
```

Add integration assertions for one-field preservation, `tags: []`, and `mood: null`.

Commit:

```bash
git add src/domains/diary/diary-service.ts src/domains/diary/diary-repository.ts \
  tests/diary-service.test.ts tests/diary-repository.integration.test.ts
git commit -m "feat: add safe Diary partial updates"
```

---

## Task 3 — Task ordinary-field partial update

**Modify**

- `src/domains/task/task-service.ts`
- `src/domains/task/task-repository.ts`
- `tests/task-service.test.ts`
- `tests/task-lifecycle-repository.integration.test.ts`

### 1. RED tests

Add service tests proving:

1. one-field patch sends only that field to repository mutation;
2. omitted fields are not reconstructed;
3. `tags: []` clears tags;
4. `dueTime: null` clears due time;
5. title/description/priority/dueTime/tags/author reuse current validation;
6. no MCP patch type contains status/resumeStatus/completedAt/timezone;
7. empty patch throws new `TaskDomainError("INVALID_TASK_PATCH", ...)`;
8. archived/missing target returns `TASK_NOT_FOUND` through the active path.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/task-service.test.ts
```

Expected: new tests fail.

### 2. Implement

In `task-service.ts` add exactly:

```ts
export type UpdateMcpTaskInput = {
  id: string;
  title?: string;
  description?: string;
  priority?: string;
  dueTime?: string | null;
  tags?: readonly string[];
  author?: ContentAuthor;
};

async updateMcpTask(
  context: AuthenticatedTaskContext,
  input: UpdateMcpTaskInput,
): Promise<TaskEntryResult>
```

Add `INVALID_TASK_PATCH` to `TaskDomainErrorCode`.

`updateMcpTask` must:

1. validate active user and exact nonblank id;
2. reject zero supplied mutable fields;
3. obtain the account timezone through existing Task behavior;
4. normalize only supplied fields;
5. normalize supplied `dueTime` with existing `normalizeDueTime(..., accountTimezone)`;
6. call repository `updateTask` with only supplied normalized fields plus `userId/id`;
7. never pass status/resumeStatus/completedAt/timezone;
8. return `readTask({ userId, id })` after success.

Refactor existing field validation into single-field helpers while preserving `createTask` and `updateWebTask` behavior.

In `task-repository.ts`, add exactly:

```ts
export type NormalizedTaskFields = {
  title: string;
  description: string;
  priority: TaskPriority;
  dueTime: Date | null;
  timezone: string;
  tags: string[];
};

export type NormalizedTaskUpdate = {
  userId: string;
  id: string;
  author?: ContentAuthor;
} & Partial<NormalizedTaskFields>;
```

Change `task-service.ts` `normalizeTaskFields(...)` return type to `NormalizedTaskFields`. Existing Web update continues to pass the full normalized field object; MCP passes only supplied patch fields.

`updateTask` must conditionally set only supplied fields plus `updatedAt`.

Retain the existing transaction-scoped active-user guard and `lifecycleStatus === "active"` predicate. `updateTask` must never mutate `status`, `resumeStatus`, or `completedAt`.

### 3. GREEN

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/task-service.test.ts
```

With a configured test database, run:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/task-lifecycle-repository.integration.test.ts
```

Add integration assertions for unrelated-field preservation, `tags: []`, and `dueTime: null`.

Commit:

```bash
git add src/domains/task/task-service.ts src/domains/task/task-repository.ts \
  tests/task-service.test.ts tests/task-lifecycle-repository.integration.test.ts
git commit -m "feat: add safe Task field patches"
```

---

## Task 4 — Task action dispatcher

**Modify**

- `src/domains/task/task-service.ts`
- `tests/task-service.test.ts`
- `tests/task-status-reopen.integration.test.ts`

**Read only**

- `src/domains/task/task-state-machine.ts`

### 1. RED tests

Add tests for a new service method that maps actions exactly:

```ts
start    -> updateWebTaskStatus({ status: "in_progress" })
complete -> updateWebTaskStatus({ status: "completed" })
cancel   -> updateWebTaskStatus({ status: "cancelled" })
reopen   -> reopenTask(...)
```

Verify:

- invalid transitions still return `INVALID_TASK_STATUS_TRANSITION`;
- concurrent state changes still return `TASK_STATUS_CONFLICT`;
- reopening restores stored `resumeStatus` (`pending` or `in_progress`).

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/task-service.test.ts
```

Expected: new dispatcher tests fail.

### 2. Implement

In `task-service.ts` add exactly:

```ts
export type TransitionMcpTaskInput = {
  id: string;
  action: TaskAction;
};

async transitionMcpTask(
  context: AuthenticatedTaskContext,
  input: TransitionMcpTaskInput,
): Promise<TaskEntryResult>
```

`transitionMcpTask` contains only the four-action switch above and delegates to existing `updateWebTaskStatus`/`reopenTask`. Do not add transition rules or repository writes here.

### 3. GREEN

Run the focused Task service test. With a configured test database, run:

```bash
RUN_TASK_STATUS_REOPEN_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/task-status-reopen.integration.test.ts
```

Commit:

```bash
git add src/domains/task/task-service.ts tests/task-service.test.ts \
  tests/task-status-reopen.integration.test.ts
git commit -m "feat: add Task MCP action dispatcher"
```

---

## Task 5 — Four MCP tools and server wiring

**Create**

- `src/mcp/tools/update-memory/register.ts`
- `src/mcp/tools/update-diary/register.ts`
- `src/mcp/tools/update-task/register.ts`
- `src/mcp/tools/transition-task/register.ts`
- `tests/mcp-resource-update-tools.test.ts`

**Modify**

- `src/mcp/tools/write-context.ts`
- `src/mcp/server/create-server.ts`
- `tests/mcp-write-contract.test.ts`

### 1. RED tests

In `tests/mcp-resource-update-tools.test.ts`, use `createMcpServer({}, AUTHENTICATED_USER_ID)` + in-memory MCP transport to assert the four tools exist with the frozen input properties, required fields, strict unknown-field rejection, and exact annotations.

Update `tests/mcp-write-contract.test.ts` expected `MCP_WRITE_TOOL_NAMES` to exactly:

```ts
[
  "create_task",
  "write_diary",
  "write_memory",
  "toy_set",
  "toy_stop",
  "write_todo_paper",
  "update_memory",
  "update_diary",
  "update_task",
  "transition_task",
]
```

Rename the existing “exactly six write tools” test to “MCP exposes exactly ten write tools and preserves every annotation”. Update its author-bearing write-tool assertion so `update_memory`, `update_diary`, and `update_task` may expose `author`; `transition_task` may not.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/mcp-write-contract.test.ts \
  tests/mcp-resource-update-tools.test.ts
```

Expected: failure because the four tools are not registered.

### 2. Implement shared write context

Append the four new names to `MCP_WRITE_TOOL_NAMES` in `src/mcp/tools/write-context.ts`.

Do not modify `src/domains/mcp-write/mcp-write-idempotency.ts` or `src/database/schema.ts`. No durable idempotency ledger rows are added for these tools.

### 3. Implement `update_memory`

Input: `id` plus the frozen Memory patch fields. Require at least one patch field with schema refinement.

Dependency interface calls only:

```ts
memoryService.updateMcpMemory(context, input)
```

Use `UpdateMemoryAuthenticationError`. Return the service readback plus `lifecycle_status: "active"` in structured content. Map known Memory domain errors to safe text. Description must say uncertain outcomes require `get_memory` readback before any retry.

### 4. Implement `update_diary`

Use `UpdateDiaryAuthenticationError`. Preserve `mood: null`. Return service readback plus `lifecycle_status: "active"`. Description must direct uncertain-outcome readback through `get_diary`.

### 5. Implement `update_task`

Input properties are exactly:

```ts
id, title?, description?, priority?, due_time?, tags?, author?
```

`due_time` uses the frozen Zod schema above and maps to service `dueTime`. Do not expose `status`, `timezone`, `resumeStatus`, or `completedAt`. Use `UpdateTaskAuthenticationError`. Return service readback plus `lifecycle_status: "active"`. Description must direct uncertain-outcome readback through `get_task`.

### 6. Implement `transition_task`

Input properties are exactly `id` and `action`. Call only:

```ts
taskService.transitionMcpTask(context, { id, action })
```

Use `TransitionTaskAuthenticationError`. Return service readback plus `lifecycle_status: "active"`. Map not-found, invalid-transition/reopen-state, and status-conflict errors separately. Description must direct uncertain-outcome readback through `get_task`; do not retry a transition blindly.

### 7. Wire server

In `src/mcp/server/create-server.ts`:

- import all four register functions and dependency types;
- add production dependency adapters calling `updateMcpMemory`, `updateMcpDiary`, `updateMcpTask`, and `transitionMcpTask`;
- add four explicit optional entries to `McpServerDependencies`: `updateMemory`, `updateDiary`, `updateTask`, `transitionTask`;
- register each tool adjacent to its existing Memory/Diary/Task group;
- use authenticated user ID exactly as existing write tools do.

Do not redesign the existing grouped dependency types.

### 8. Extend behavior tests and GREEN

Extend `tests/mcp-resource-update-tools.test.ts` with injected dependencies and assert:

- exact authenticated user context reaches each service;
- omitted fields stay omitted in service input;
- `tags: []`, `mood: null`, and `due_time: null` survive transport unchanged;
- empty patches fail schema validation and never call service;
- `update_task` rejects `status` and `timezone`;
- `transition_task` rejects target statuses and accepts only the four actions;
- successful structured content is the canonical active readback;
- domain/auth failures return safe MCP errors.

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/mcp-write-contract.test.ts \
  tests/mcp-resource-update-tools.test.ts \
  tests/write-memory-tool.test.ts \
  tests/write-diary-tool.test.ts \
  tests/create-task-tool.test.ts
```

Expected: all pass.

Commit:

```bash
git add src/mcp/tools/update-memory/register.ts src/mcp/tools/update-diary/register.ts \
  src/mcp/tools/update-task/register.ts src/mcp/tools/transition-task/register.ts \
  src/mcp/tools/write-context.ts src/mcp/server/create-server.ts \
  tests/mcp-write-contract.test.ts tests/mcp-resource-update-tools.test.ts
git commit -m "feat: expose safe MCP resource updates"
```

---

## Task 6 — Final verification and PR

Run from the final branch head:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
git diff --stat b8e551307d22ee91914b6182e3ea5c956111307b...HEAD
git log --oneline b8e551307d22ee91914b6182e3ea5c956111307b..HEAD
```

Required result:

- `pnpm test`: pass for every test that actually runs;
- `pnpm typecheck`: exit 0;
- `pnpm build`: exit 0;
- `git diff --check`: clean;
- diff contains only this plan plus Memory/Diary/Task partial-update, Task transition, MCP wiring, and related tests;
- no migration, UI, lifecycle-tool, Page, Universe, or unrelated changes.

Database-gated tests must also be green before merge. If the local environment lacks a test database, record them as **not run locally** and require CI or another configured test environment to execute them; never report skipped/gated tests as passed.

Open exactly one PR to `main`:

**Title**

```text
feat: add safe MCP resource updates
```

PR body must contain:

- the four new tool names;
- partial-patch semantics;
- transaction-level prevention of stale full-record overwrite;
- Task state separation and `resumeStatus` reopen behavior;
- no idempotency migration;
- exact verification commands/results;
- exact database-gated tests not run locally, if any.

Do not merge until required CI is green on the reviewed PR head SHA. If the head SHA changes, rerun the relevant verification on the new head.

A merged PR is not production acceptance. Production verification is a separate step and must use deployed-SHA/runtime evidence without synthetic or destructive production writes.
