# ChatGPT Resource Updates Implementation Plan

> **For Codex:** Execute task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming completion.

**Base:** `b8e551307d22ee91914b6182e3ea5c956111307b`

**Branch:** `feature/mcp-resource-updates`

**Goal:** Add exactly four ChatGPT/MCP mutations: `update_memory`, `update_diary`, `update_task`, `transition_task`.

## Frozen contract

All four tools:

- `id: z.string().trim().min(1)`;
- strict Zod object;
- no `user_id`, `userId`, or `idempotency_key`;
- annotations exactly `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }`;
- no durable idempotency-ledger/schema changes;
- after uncertain outcome: read target back; never blind-retry.

`update_memory` fields:

```ts
id: z.string().trim().min(1)
category: z.enum(["profile", "preference", "goal", "project"]).optional()
key: z.string().max(1_000).optional()
content: z.string().max(20_000).optional()
tags: z.array(z.string().max(500)).max(20).optional()
author: z.enum(["L", "G"]).optional()
```

Require at least one mutable field. Omitted = unchanged. `tags: []` = clear. No field accepts `null`.

`update_diary` fields:

```ts
id: z.string().trim().min(1)
title: z.string().min(1).max(200).optional()
content: z.string().min(1).max(20_000).optional()
date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
tags: z.array(z.string().min(1).max(50)).max(20).optional()
mood: z.string().min(1).max(50).nullable().optional()
author: z.enum(["L", "G"]).optional()
```

Require at least one mutable field. Omitted = unchanged. `tags: []` = clear. `mood: null` = clear mood.

`update_task` fields:

```ts
id: z.string().trim().min(1)
title: z.string().min(1).max(200).optional()
description: z.string().min(1).max(5_000).optional()
priority: z.enum(["low", "normal", "high", "urgent"]).optional()
due_time: z.string().trim().min(1).max(64).nullable().optional()
tags: z.array(z.string().min(1).max(50)).max(20).optional()
author: z.enum(["L", "G"]).optional()
```

Require at least one mutable field. Omitted = unchanged. `tags: []` = clear. `due_time: null` = clear due time. Do not expose `status`, `timezone`, `resumeStatus`, or `completedAt`. Domain `parseTaskDueTime` remains authoritative for accepted timestamp forms/account timezone.

`transition_task` input:

```ts
id: z.string().trim().min(1)
action: z.enum(["start", "complete", "cancel", "reopen"])
```

Allowed actions are the existing Task state-machine actions. `reopen` must preserve stored `resumeStatus`.

Repository mutation rule for all ordinary patches:

- validate only supplied fields;
- never pre-read and reconstruct omitted values into a full update;
- repository transaction retains active-user guard and active lifecycle predicate;
- `.set()` contains only supplied fields plus `updatedAt`;
- successful MCP mutation returns a fresh active read via existing `readMemoryDetail` / `readDiary` / `readTask`.

Out of scope: UI, migrations, archive/restore/delete MCP tools, Page/Universe writes, state-machine redesign, production acceptance writes, unrelated refactors.

---

## Task 1 — Memory patch

Modify:

- `src/domains/memory/memory-service.ts`
- `src/domains/memory/memory-repository.ts`
- `tests/memory-detail-service.test.ts`
- `tests/memory-repository-update-contract.test.ts`
- `tests/memory-lifecycle-repository.integration.test.ts`

Add exactly:

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

Behavior:

1. validate active user and nonblank id;
2. reject empty patch;
3. normalize only supplied fields with existing Memory validators;
4. call `repository.updateMemory({ userId, id, ...patch })` with supplied fields only;
5. repository `UpdateMemoryInput` makes `key/category/content/tags/author` optional;
6. repository `.set()` uses property presence/`!== undefined`, never truthiness (`tags: []` must write);
7. retain current transaction guard and predicates: id, user, active status, assistant visibility;
8. repository false -> `MEMORY_NOT_FOUND`;
9. success -> `readMemoryDetail({ userId, id })`.

RED/GREEN command:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts
```

Integration gate:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/memory-lifecycle-repository.integration.test.ts
```

Integration assertions: content-only update preserves unrelated fields; `tags: []` clears tags.

Commit: `feat: add safe Memory partial updates`.

---

## Task 2 — Diary patch

Modify:

- `src/domains/diary/diary-service.ts`
- `src/domains/diary/diary-repository.ts`
- `tests/diary-service.test.ts`
- `tests/diary-repository.integration.test.ts`

Add exactly:

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

Behavior:

1. validate active user and nonblank id;
2. reject empty patch;
3. extract/reuse field validators from current `normalizeDiaryFields`; keep `updateWebDiary` full-update semantics unchanged;
4. normalize only supplied fields;
5. repository `UpdateDiaryInput` makes `title/content/date/tags/mood/author` optional;
6. repository `.set()` uses property presence, preserving `tags: []` and `mood: null`;
7. retain active-user transaction guard and active Diary predicate;
8. repository null -> `DIARY_NOT_FOUND`;
9. success -> `readDiary({ userId, id })`.

RED/GREEN:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/diary-service.test.ts
```

Integration:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/diary-repository.integration.test.ts
```

Integration assertions: one-field preservation; `tags: []`; `mood: null`.

Commit: `feat: add safe Diary partial updates`.

---

## Task 3 — Task ordinary-field patch

Modify:

- `src/domains/task/task-service.ts`
- `src/domains/task/task-repository.ts`
- `tests/task-service.test.ts`
- `tests/task-lifecycle-repository.integration.test.ts`

Add exactly:

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

In repository add exactly:

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

Change current `normalizeTaskFields(...)` return type to `NormalizedTaskFields`; Web create/update keep passing the full object.

Behavior:

1. validate active user and nonblank id;
2. reject empty patch;
3. get account timezone using existing Task behavior;
4. normalize only supplied title/description/priority/dueTime/tags/author;
5. supplied `dueTime` uses existing `normalizeDueTime(..., accountTimezone)`;
6. never put `timezone`, `status`, `resumeStatus`, or `completedAt` into the MCP repository patch;
7. repository `.set()` includes supplied fields only plus `updatedAt`;
8. retain active-user transaction guard and active lifecycle predicate;
9. repository null -> `TASK_NOT_FOUND`;
10. success -> `readTask({ userId, id })`.

RED/GREEN:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/task-service.test.ts
```

Integration:

```bash
RUN_DATABASE_INTEGRATION_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/task-lifecycle-repository.integration.test.ts
```

Integration assertions: one-field preservation; `tags: []`; `dueTime: null`.

Commit: `feat: add safe Task field patches`.

---

## Task 4 — Task action transition

Modify:

- `src/domains/task/task-service.ts`
- `tests/task-service.test.ts`
- `tests/task-status-reopen.integration.test.ts`

Read only: `src/domains/task/task-state-machine.ts`.

Add exactly:

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

Behavior:

1. `const current = await readTask({ userId: context.userId, id: input.id })`;
2. reject action unless `current.allowed_actions.includes(input.action)`;
3. invalid `reopen` -> `INVALID_TASK_REOPEN_STATE`; other invalid actions -> `INVALID_TASK_STATUS_TRANSITION`;
4. delegate only:
   - `start` -> `updateWebTaskStatus(..., status: "in_progress")`;
   - `complete` -> `updateWebTaskStatus(..., status: "completed")`;
   - `cancel` -> `updateWebTaskStatus(..., status: "cancelled")`;
   - `reopen` -> `reopenTask(...)`;
5. do not add a second transition table;
6. after delegated success, return `readTask({ userId: context.userId, id: input.id })`;
7. keep existing `TASK_STATUS_CONFLICT` behavior; never retry automatically.

Tests must prove allowed action matrix, representative invalid actions, status conflict propagation, and `resumeStatus` reopening to both `pending` and `in_progress`.

RED/GREEN:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/task-service.test.ts
```

Integration:

```bash
RUN_TASK_STATUS_REOPEN_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/task-status-reopen.integration.test.ts
```

Commit: `feat: add Task MCP action transition`.

---

## Task 5 — MCP tools + server wiring

Create:

- `src/mcp/tools/update-memory/register.ts`
- `src/mcp/tools/update-diary/register.ts`
- `src/mcp/tools/update-task/register.ts`
- `src/mcp/tools/transition-task/register.ts`
- `tests/mcp-resource-update-tools.test.ts`

Modify:

- `src/mcp/tools/write-context.ts`
- `src/mcp/server/create-server.ts`
- `tests/mcp-write-contract.test.ts`

`MCP_WRITE_TOOL_NAMES` becomes exactly:

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

Do not modify `src/domains/mcp-write/mcp-write-idempotency.ts` or `src/database/schema.ts`.

Tool dependencies call only:

```ts
memoryService.updateMcpMemory(context, input)
diaryService.updateMcpDiary(context, input)
taskService.updateMcpTask(context, input)
taskService.transitionMcpTask(context, input)
```

Create authentication errors exactly:

- `UpdateMemoryAuthenticationError`
- `UpdateDiaryAuthenticationError`
- `UpdateTaskAuthenticationError`
- `TransitionTaskAuthenticationError`

Each success output matches the corresponding existing `get_memory` / `get_diary` / `get_task` `data` shape, with `lifecycle_status: "active"`. Do not synthesize derived Task fields outside the domain result.

`create-server.ts`:

- add four register imports/dependency types;
- add four production adapters;
- add explicit `McpServerDependencies` entries `updateMemory`, `updateDiary`, `updateTask`, `transitionTask`;
- register each adjacent to its resource group;
- do not redesign grouped dependency types.

Tests:

- exact schemas/annotations;
- no identity/idempotency arguments;
- empty patches rejected before service call;
- omitted fields remain omitted;
- `tags: []`, `mood: null`, `due_time: null` preserved;
- `update_task` rejects `status` and `timezone`;
- `transition_task` accepts only four actions;
- authenticated user context reaches service exactly once;
- safe domain/auth errors;
- canonical active readback.

Update existing write-contract test from six to ten write tools. `update_memory`, `update_diary`, `update_task` may expose `author`; `transition_task` may not.

RED before registration:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/mcp-write-contract.test.ts tests/mcp-resource-update-tools.test.ts
```

GREEN after implementation:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/mcp-write-contract.test.ts tests/mcp-resource-update-tools.test.ts \
  tests/write-memory-tool.test.ts tests/write-diary-tool.test.ts tests/create-task-tool.test.ts
```

Commit: `feat: expose safe MCP resource updates`.

---

## Task 6 — Verification + PR

Run from final branch head:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
git diff --stat b8e551307d22ee91914b6182e3ea5c956111307b...HEAD
git log --oneline b8e551307d22ee91914b6182e3ea5c956111307b..HEAD
```

Required:

- every executed test passes;
- typecheck/build exit 0;
- diff check clean;
- no UI, migration, lifecycle-tool, Page, Universe, or unrelated changes;
- database-gated tests green before merge; if not runnable locally, record **not run locally** and require configured CI/test environment to run them.

Open exactly one PR to `main`.

Title: `feat: add safe MCP resource updates`.

PR body: four tools; partial-patch semantics; transaction-level lost-update protection; Task action/state separation + `resumeStatus`; no idempotency migration; exact verification results; exact gated tests not run locally.

Do not merge until required CI is green on the reviewed head SHA. A merged PR is not production acceptance.