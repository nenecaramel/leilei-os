# ChatGPT Resource Updates Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming completion.

**Goal:** Expose safe partial updates for Memory, Diary, and Task plus explicit Task state actions through MCP without bypassing domain validation, active-user authorization, lifecycle scope, or Task state-machine rules.

**Base commit:** `b8e551307d22ee91914b6182e3ea5c956111307b`

**Working branch:** `feature/mcp-resource-updates`

**Architecture:** MCP tools validate transport shape and authenticate the caller. Domain services normalize and validate only fields that are actually present in a patch. Repository mutation methods perform the authoritative active-user guard and a field-level partial `SET` inside the write transaction. Do not reconstruct a full record from a pre-write read. Task state changes are a separate operation and delegate to the existing state-transition service methods. Successful MCP mutations return a fresh authoritative readback.

**Tech stack:** TypeScript, Zod, MCP SDK, Drizzle/Postgres, Node test runner via `tsx`, pnpm.

## Frozen contract

Implement exactly these new MCP mutations:

- `update_memory`
- `update_diary`
- `update_task`
- `transition_task`

For `update_memory`, `update_diary`, and `update_task`:

- They are partial-patch operations.
- An omitted field means “leave stored value unchanged.”
- An explicit empty array means “clear this array field.”
- `null` is accepted only for fields that are already nullable in that domain.
- A patch containing no mutable fields is invalid.
- Do **not** fresh-read an object in MCP/service code, merge omitted fields into it, and call an existing full-record update method. That creates a lost-update window.
- The authoritative repository write transaction must guard the active user and issue `SET` only for fields that were supplied, plus normal server-maintained timestamps.

For Task:

- `update_task` must not expose or accept `status`.
- `transition_task.action` is exactly `start | complete | cancel | reopen`.
- Reuse the current Task state-machine/service behavior. Do not duplicate transition rules in MCP.
- `reopen` must call the existing reopen behavior so the stored `resumeStatus` decides whether the restored active status is `pending` or `in_progress`.

Safety and retry rules:

- Existing create-only MCP idempotency behavior remains unchanged.
- Do not add an idempotency database migration in this PR.
- Do not add the four new tools to the durable create ledger unless a separately approved migration is introduced later.
- `transition_task` is non-idempotent from the caller’s perspective: after an uncertain outcome, read the task back and do not blindly retry.
- Treat the `update_*` tools conservatively as non-idempotent in MCP annotations as well; they change server-maintained `updatedAt` and have no durable replay ledger in this PR.
- If implementation inspection discovers that the MCP transport automatically replays non-idempotent mutations, stop and escalate the idempotency contract instead of weakening this safety rule.

Out of scope:

- UI changes.
- Archive, restore, or permanent-delete MCP tools.
- Task state-machine redesign or new statuses/actions.
- Generic Page/Universe mutations.
- Production database writes during development/acceptance.
- Bulk autonomous rewrites, silent sync, or cross-resource implicit side effects.
- Unrelated refactors.

---

## Task 1: Lock the public MCP mutation contract with failing tests

**Files:**

- Modify: `tests/mcp-write-contract.test.ts`
- Create if a focused test file is cleaner: `tests/mcp-resource-update-tools.test.ts`
- Read for patterns: `tests/write-memory-tool.test.ts`
- Read for patterns: `tests/write-diary-tool.test.ts`
- Read for patterns: `tests/create-task-tool.test.ts`

### Step 1: Add RED tests for tool registration and schemas

Add tests that instantiate the MCP server with test dependencies and assert the four tools are visible.

Required assertions:

```ts
const expectedMutationTools = [
  "update_memory",
  "update_diary",
  "update_task",
  "transition_task",
];
```

For all three `update_*` tools, assert:

- `id` is required and is a UUID-shaped string if existing resource ids use UUID schemas.
- mutable data fields are optional.
- the schema rejects a request containing only `id`.
- unknown fields are rejected by a strict object schema.
- `idempotency_key` is not introduced in this PR.
- annotations are `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`.

For `update_task`, explicitly assert `status` is not a schema property and a request containing `status` is rejected.

For `transition_task`, assert:

```ts
action: z.enum(["start", "complete", "cancel", "reopen"])
```

and no arbitrary target status is accepted.

### Step 2: Run the focused contract test and observe RED

Run:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/mcp-write-contract.test.ts
```

If a new focused file was created, include it in the command as a second path.

Expected: failure because the new tools are not registered yet.

Do not continue until the failure is caused by the missing/new behavior rather than a broken fixture or syntax error.

### Step 3: Commit the RED contract tests

```bash
git add tests/mcp-write-contract.test.ts tests/mcp-resource-update-tools.test.ts
git commit -m "test: define MCP resource update contract"
```

Only include the second file if it exists.

---

## Task 2: Implement Memory field-level patching without stale full-record merge

**Files:**

- Modify: `src/domains/memory/memory-service.ts`
- Modify: `src/domains/memory/memory-repository.ts`
- Modify: `tests/memory-detail-service.test.ts`
- Modify: `tests/memory-repository-update-contract.test.ts`
- Modify if database fixture coverage is needed: `tests/memory-lifecycle-repository.integration.test.ts`

### Step 1: Add failing service/repository tests

Cover at minimum:

1. Updating only `content` leaves `key`, `category`, `tags`, and `author` untouched.
2. `tags: []` clears tags.
3. Omitted `tags` does not clear tags.
4. Empty patch fails validation before repository mutation.
5. Existing Memory key conflict/error taxonomy is preserved when `key` is supplied and conflicts.
6. Archived/non-active-scope Memory cannot be mutated through the active update path.
7. A concurrent unrelated field change cannot be overwritten by a patch to another field. Test the repository contract by verifying the generated/update input contains only supplied fields rather than a reconstructed complete Memory object.

Suggested domain input shape:

```ts
export type UpdateMemoryPatchInput = {
  category?: string;
  key?: string;
  content?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};
```

Use presence checks (`value !== undefined` or `Object.hasOwn`) rather than falsy checks so `[]` remains meaningful.

### Step 2: Run Memory tests and observe RED

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/memory-detail-service.test.ts \
  tests/memory-repository-update-contract.test.ts
```

Expected: new patch tests fail before implementation.

### Step 3: Add a domain patch method

Implement a clearly named service entry point such as `updateMemoryPatch(context, id, patch)` or the closest naming convention already present.

Requirements:

- Authenticate/normalize the user id using existing Memory behavior.
- Validate `id` and active target semantics consistently with existing detail reads.
- Normalize/validate **only supplied fields**.
- Extract/reuse existing category/key/content/tags/author validators rather than duplicating business rules.
- Do not fill omitted fields from a pre-write snapshot.
- Return the canonical Memory result shape used by MCP reads.

A pre-write read may be used only for scope/existence or validation that truly requires current state. It must not become the source of omitted values passed to the repository write.

### Step 4: Add a repository partial-update method

Add a patch-oriented repository input, for example:

```ts
type NormalizedMemoryPatch = {
  category?: MemoryCategory;
  key?: string;
  content?: string;
  tags?: string[];
  author?: ContentAuthor;
};
```

Inside the repository transaction:

1. Call the same transaction-scoped active-user lock/guard used by current writes.
2. Build the Drizzle `.set()` object only from keys present in the normalized patch.
3. Add `updatedAt` server-side.
4. Restrict the `WHERE` clause to the authenticated active user, target id, and active lifecycle scope exactly as existing active mutation methods do.
5. Preserve current unique-key conflict translation/error taxonomy.
6. Return the updated row or a not-found signal according to current repository conventions.

Do not implement this as `find -> spread old row -> update all columns`.

### Step 5: Run Memory tests GREEN

Run the focused command from Step 2 and, if changed, the lifecycle integration test under its existing database gate.

### Step 6: Commit

```bash
git add src/domains/memory/memory-service.ts src/domains/memory/memory-repository.ts tests/memory-detail-service.test.ts tests/memory-repository-update-contract.test.ts tests/memory-lifecycle-repository.integration.test.ts
git commit -m "feat: add safe Memory partial updates"
```

Do not stage unchanged optional files.

---

## Task 3: Implement Diary field-level patching with nullable mood semantics

**Files:**

- Modify: `src/domains/diary/diary-service.ts`
- Modify: `src/domains/diary/diary-repository.ts`
- Modify: `tests/diary-service.test.ts`
- Modify: `tests/diary-repository.integration.test.ts`

### Step 1: Add failing patch tests

Cover:

- single-field title/content/date updates preserve all omitted fields;
- `tags: []` clears tags;
- omitted `tags` preserves tags;
- `mood: null` clears mood because mood is currently nullable;
- omitted `mood` preserves mood;
- invalid empty patch rejects;
- author validation remains consistent with current Diary rules;
- archived/non-active rows are not writable through the active update path;
- unrelated concurrent field changes are not overwritten by another field’s patch.

Suggested input shape:

```ts
export type UpdateDiaryPatchInput = {
  title?: string;
  content?: string;
  date?: string;
  tags?: readonly string[];
  mood?: string | null;
  author?: ContentAuthor;
};
```

Do not allow `null` for title/content/date/tags/author unless the existing domain already permits it.

### Step 2: Run Diary tests RED

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/diary-service.test.ts \
  tests/diary-repository.integration.test.ts
```

If the integration file is environment-gated and cannot execute locally, run the service test immediately and record the integration test as pending CI/database verification; do not claim it passed.

### Step 3: Implement service normalization for supplied fields only

Reuse/extract existing `updateWebDiary` field validators. Keep Web full-update behavior compatible. Add a patch-specific path rather than changing omitted-field semantics of existing Web callers.

### Step 4: Implement transaction-scoped partial repository `SET`

Follow the same rules as Memory: active-user guard inside the transaction, active lifecycle scope, only supplied columns in `.set()`, server-maintained `updatedAt`, no stale full-object merge.

### Step 5: Run focused Diary tests GREEN and commit

```bash
git add src/domains/diary/diary-service.ts src/domains/diary/diary-repository.ts tests/diary-service.test.ts tests/diary-repository.integration.test.ts
git commit -m "feat: add safe Diary partial updates"
```

---

## Task 4: Implement ordinary Task field patching; keep status out

**Files:**

- Modify: `src/domains/task/task-service.ts`
- Modify: `src/domains/task/task-repository.ts`
- Modify: `tests/task-service.test.ts`
- Modify if appropriate: `tests/task-lifecycle-repository.integration.test.ts`

### Step 1: Add RED tests

Cover ordinary Task fields supported by the existing Web update path:

- `title`
- `description`
- `priority`
- `dueTime`
- `timezone` only under existing timezone rules
- `tags`
- `author`

Required semantics:

- omitted field unchanged;
- `tags: []` clears tags;
- `dueTime: null` clears due time because that field is already nullable;
- empty patch rejects;
- no patch type contains `status`;
- current due-time/timezone validation remains unchanged;
- active-user/lifecycle guard remains authoritative;
- unrelated concurrent changes are not overwritten.

Suggested patch type:

```ts
export type UpdateTaskPatchInput = {
  title?: string;
  description?: string;
  priority?: string;
  dueTime?: string | null;
  timezone?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};
```

### Step 2: Run Task patch tests RED

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 tests/task-service.test.ts
```

### Step 3: Implement supplied-field normalization

Do not call existing `updateWebTask` with reconstructed fields. Extract reusable per-field validators from `normalizeTaskFields` where needed so existing behavior and errors stay aligned.

Timezone/due-time coupling needs special care: preserve the existing account-timezone rules. A patch that changes only one of these fields must validate that field without manufacturing stale values for the other one.

### Step 4: Implement repository partial update transaction

Use the current transaction-scoped active-user guard and active lifecycle predicate. Build `.set()` only from supplied fields plus `updatedAt`. Do not modify `status`, `resumeStatus`, or `completedAt` in this method.

### Step 5: Run Task patch tests GREEN and commit

```bash
git add src/domains/task/task-service.ts src/domains/task/task-repository.ts tests/task-service.test.ts tests/task-lifecycle-repository.integration.test.ts
git commit -m "feat: add safe Task field patches"
```

Do not stage unchanged optional files.

---

## Task 5: Expose Task actions through existing state logic

**Files:**

- Modify: `src/domains/task/task-service.ts` only if a thin action-dispatch method materially reduces MCP duplication; otherwise leave it unchanged.
- Modify: `tests/task-service.test.ts`
- Modify: `tests/task-status-reopen.integration.test.ts`
- Read: `src/domains/task/task-state-machine.ts`

### Step 1: Add RED/coverage tests for action behavior

Existing rules are the source of truth:

- pending: `start`, `cancel`
- in_progress: `complete`, `cancel`
- completed: `reopen`
- cancelled: `reopen`

Test all allowed actions and at least representative invalid actions.

Most importantly, verify:

- completing/cancelling records the existing `resumeStatus` behavior;
- reopening a previously pending task restores `pending`;
- reopening a previously in-progress task restores `in_progress`;
- transition concurrency conflict remains `TASK_STATUS_CONFLICT` rather than being hidden or retried.

### Step 2: Reuse existing methods

The current service already has:

- `updateWebTaskStatus(...)` with state transition validation and expected-status concurrency checks;
- `reopenTask(...)` with stored `resumeStatus` restoration.

The MCP layer may map actions as follows:

```ts
switch (action) {
  case "start":
    return taskService.updateWebTaskStatus({ userId, id, status: "in_progress" });
  case "complete":
    return taskService.updateWebTaskStatus({ userId, id, status: "completed" });
  case "cancel":
    return taskService.updateWebTaskStatus({ userId, id, status: "cancelled" });
  case "reopen":
    return taskService.reopenTask({ userId, id });
}
```

If a domain-level `transitionTaskAction` wrapper is added, it must only delegate to those existing semantics; do not implement a second state machine.

### Step 3: Run transition/reopen tests

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/task-service.test.ts \
  tests/task-status-reopen.integration.test.ts
```

Honor any existing database-test environment gate. Never report a gated test as passed if it did not run.

### Step 4: Commit only if domain/test code changed

```bash
git add src/domains/task/task-service.ts tests/task-service.test.ts tests/task-status-reopen.integration.test.ts
git commit -m "test: lock Task MCP transition semantics"
```

---

## Task 6: Add the four MCP tools and wire them into the server

**Files:**

- Create: `src/mcp/tools/update-memory/register.ts`
- Create: `src/mcp/tools/update-diary/register.ts`
- Create: `src/mcp/tools/update-task/register.ts`
- Create: `src/mcp/tools/transition-task/register.ts`
- Modify: `src/mcp/tools/write-context.ts`
- Modify: `src/mcp/server/create-server.ts`
- Modify: `tests/mcp-write-contract.test.ts`
- Modify/create: `tests/mcp-resource-update-tools.test.ts`

### Step 1: Extend MCP write context names only

`src/mcp/tools/write-context.ts` currently constrains `McpWriteToolName`. Add:

```ts
"update_memory",
"update_diary",
"update_task",
"transition_task",
```

This is **not** the durable idempotency ledger. Do not modify the `mcp_write_idempotency` database schema or its create-only tool-name constraints in this PR.

### Step 2: Implement `update_memory`

Follow the structural conventions in `src/mcp/tools/write-memory/register.ts`:

- strict Zod input;
- `id` plus optional mutable Memory fields;
- `.refine(...)` or equivalent to require at least one mutable field;
- no `idempotency_key`;
- `invokeMcpWrite({ toolName: "update_memory", ... })`;
- service dependency exposes only the patch method needed by the tool;
- map known `MemoryDomainError` codes to safe user-facing text;
- annotations use `idempotentHint: false`;
- successful operation returns a fresh authoritative active Memory readback, not a locally merged approximation.

The tool description must instruct the model: after an uncertain outcome, use `get_memory` to inspect current stored state before considering any further action; do not blindly retry.

### Step 3: Implement `update_diary`

Mirror the same pattern using Diary domain errors and `get_diary` semantics. Ensure `mood: null` is representable and omitted mood remains omitted.

### Step 4: Implement `update_task`

Input must not expose `status`, `resumeStatus`, or `completedAt`.

Return a canonical Task shape including existing derived fields such as `allowed_actions`/time bucket if that is the domain read result. Do not synthesize those fields in MCP if the service can return the canonical Task result.

### Step 5: Implement `transition_task`

Input shape:

```ts
const transitionTaskInputSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["start", "complete", "cancel", "reopen"]),
}).strict();
```

Delegate each action to the existing Task service behavior described in Task 5. Do not retry on `TASK_STATUS_CONFLICT` or any uncertain write outcome. Map invalid-transition/not-found/conflict errors to distinct safe text where current error taxonomy allows it.

### Step 6: Wire dependencies in `src/mcp/server/create-server.ts`

Add imports, production dependency adapters, dependency override types for tests, and `register*Tool(...)` calls alongside the existing Memory/Diary/Task tool groups.

Keep dependency injection testable. Prefer grouped dependency types that extend the existing `memoryReads`/`diaryTools`/`taskTools` shape only when doing so does not break current tests; otherwise add explicit optional dependency entries analogous to `writeMemory`, `writeDiary`, and `createTask`.

### Step 7: Run MCP tests GREEN

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/mcp-write-contract.test.ts \
  tests/mcp-resource-update-tools.test.ts
```

Also rerun existing create tool tests to prove compatibility:

```bash
pnpm exec tsx --import ./tests/register-css-loader.mjs --test --test-concurrency=1 \
  tests/write-memory-tool.test.ts \
  tests/write-diary-tool.test.ts \
  tests/create-task-tool.test.ts
```

### Step 8: Commit

```bash
git add src/mcp/tools/update-memory/register.ts src/mcp/tools/update-diary/register.ts src/mcp/tools/update-task/register.ts src/mcp/tools/transition-task/register.ts src/mcp/tools/write-context.ts src/mcp/server/create-server.ts tests/mcp-write-contract.test.ts tests/mcp-resource-update-tools.test.ts
git commit -m "feat: expose safe MCP resource updates"
```

---

## Task 7: End-to-end mutation safety/readback tests

**Files:**

- Modify/create: `tests/mcp-resource-update-tools.test.ts`
- Modify: `tests/memory-repository-update-contract.test.ts`
- Modify: `tests/diary-repository.integration.test.ts`
- Modify: `tests/task-lifecycle-repository.integration.test.ts`
- Modify: `tests/task-status-reopen.integration.test.ts`

Add the final acceptance cases that span boundaries:

1. Authenticated active user can update its active resource.
2. Wrong/disabled user cannot mutate another/non-active scope resource.
3. Omitted field remains byte-for-byte/domain-equivalent unchanged.
4. Explicit `[]` clears array fields.
5. Only domain-nullable values accept `null` (`Diary.mood`, `Task.dueTime`, plus any other existing nullable field confirmed from code); non-nullable fields reject it at schema/domain boundary.
6. A stale pre-read cannot overwrite a concurrent unrelated field change because repository patch SQL only sets supplied fields.
7. Successful MCP response/readback reflects the authoritative stored row after mutation.
8. `update_task` cannot change status.
9. `transition_task` rejects invalid state transitions.
10. `reopen` preserves `resumeStatus` semantics.
11. No new row is written to the durable create idempotency ledger for these tools unless the frozen contract is intentionally revised in a separate migration.

Do not create tests that perform writes against production configuration.

Run focused acceptance tests and make them green before proceeding.

Commit any remaining acceptance-only changes:

```bash
git add tests
git commit -m "test: verify MCP mutation safety boundaries"
```

---

## Task 8: Full verification and PR handoff

### Step 1: Run the complete test suite

```bash
pnpm test
```

Expected: all non-gated repository tests pass.

### Step 2: Run typecheck

```bash
pnpm typecheck
```

Expected: exit 0.

### Step 3: Run build

```bash
pnpm build
```

Expected: exit 0.

### Step 4: Check diff hygiene

```bash
git diff --check
```

Expected: no whitespace errors.

### Step 5: Inspect final scope

```bash
git status --short
git diff --stat b8e551307d22ee91914b6182e3ea5c956111307b...HEAD
git log --oneline --decorate b8e551307d22ee91914b6182e3ea5c956111307b..HEAD
```

Reject accidental UI, database migration, lifecycle-tool, generic Page, Universe, or unrelated refactor changes.

### Step 6: Open one PR

Suggested title:

```text
feat: add safe MCP resource updates
```

PR body must state:

- four tools added;
- partial-patch semantics and transaction-level lost-update protection;
- Task status separated into state-machine actions;
- no idempotency DB migration;
- exact tests/typecheck/build commands executed and their results;
- any database-gated tests that were not actually executed;
- production was not manually mutated for acceptance.

### Step 7: Merge gate

Do not merge until required CI is green and the PR head SHA is the SHA that was reviewed/verified. If the head changes, re-run/inspect the relevant gates against the new head.

Do not claim production acceptance merely because code merged. Production verification is a separate step and must use exact deployed-SHA/runtime evidence without performing destructive or synthetic production writes.

---

## Implementation notes for Codex

- Preserve existing public Web behavior; add patch-specific domain/repository paths rather than silently changing full-update callers to new omission semantics.
- Reuse existing resource limit constants and field-normalization helpers.
- Keep MCP response schemas aligned with domain canonical result shapes rather than manually drifting copies when a shared schema/helper can be introduced locally without broad refactoring.
- Never use falsy checks to detect whether a patch key is present; empty arrays and `null` have explicit meaning.
- Do not use a pre-write read as the source of omitted values for the subsequent write.
- If a validation rule needs current state, read it for validation only; repository mutation still writes only supplied fields.
- Keep active-user authorization in both the normal service path and the repository transaction guard where the current architecture expects it; do not weaken the durable guard because MCP authenticated successfully.
- Preserve current domain error taxonomy. Add a new error code only when an existing code cannot accurately represent the new invalid request.
- No success claim without fresh test/typecheck/build evidence from the final branch head.
