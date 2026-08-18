# MCP Final Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three frozen Todo MCP tools, extend persistent MCP idempotency safely for whole-paper Todo writes, and close the cross-cutting MCP auth/author/annotation/privacy/audit contracts without adding any other product capability.

**Architecture:** Reuse the accepted `TodoService` and `DrizzleTodoRepository`. Read tools delegate directly to existing Todo reads. The write path adds one MCP-specific idempotent service/repository method that composes the existing whole-paper optimistic mutation with the existing durable MCP advisory-lock/idempotency table in one PostgreSQL transaction. `createMcpServer` owns production dependency wiring; transport identity remains server-owned.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, Zod, Drizzle ORM/Kit, PostgreSQL, Node test runner + `tsx`, Express.

## Global Constraints

- Implementation branch: `feat/mcp-final-closure`.
- Frozen base: `e544e9647a26222263ef3bb00d72f319a428a384` on `codex/phase-6-web-ui-foundation`.
- Read and obey `docs/superpowers/specs/2026-08-13-mcp-final-closure-design.md` before editing code.
- Add exactly `read_todo_day`, `list_todo_dates`, and `write_todo_paper`; final MCP count must be 19 and write-tool count 6.
- Do not add Day Space/Calendar aggregate tools or Memory/Diary/Task edit/archive/restore/delete tools.
- Do not change Web/PWA UI or Web Todo semantics.
- Do not infer author. `write_todo_paper.author` is required and only `L`/`G`.
- Do not accept user identity in any Todo tool input.
- Do not store Todo text/request payload/response snapshots in idempotency or audit tables.
- `write_todo_paper` is `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: false`.
- Preserve current Diary-specific `tool_calls` behavior. Do not create a universal audit subsystem; Todo MCP writes create neither `tool_calls` nor lifecycle rows.
- Generate but do not apply migration `0017` to production. No production access in this implementation plan.
- Keep `web/preview.html` and `web/src/preview-main.tsx` untracked and untouched.
- Do not touch the PWA branch/worktree.
- No force push.

---

## Task 1: Freeze the failing MCP surface contracts

**Files:**
- Modify: `tests/mcp-read-contract.test.ts`
- Modify: `tests/mcp-write-contract.test.ts`
- Create: `tests/todo-mcp-tools.test.ts`

- [ ] **Step 1: Update the read-contract expectation to include the two Todo reads.**

Add `read_todo_day` and `list_todo_dates` to the read-only contract list. Their expected annotations are exactly:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

Add a Todo fake/dependency seam to the fixture only as needed by the eventual server API. Assert neither read schema exposes `userId` nor `user_id`.

- [ ] **Step 2: Update the write-contract expectation from five to six writes.**

Expected `MCP_WRITE_TOOL_NAMES` becomes:

```ts
[
  "create_task",
  "write_diary",
  "write_memory",
  "toy_set",
  "toy_stop",
  "write_todo_paper",
]
```

For `write_todo_paper`, assert:
- `readOnlyHint === false`
- `destructiveHint === true`
- `idempotentHint === true`
- `openWorldHint === false`
- required schema fields include `date`, `author`, `revision`, `entries`, `idempotency_key`
- no user identity input exists.

Extend identity-injection and safe-failure cases to Todo.

- [ ] **Step 3: Add a focused Todo MCP tool contract test file.**

Write failing tests covering:
- expected three tool names exist;
- no `get_day_space`, `list_calendar_dates`, Todo entry-level mutation, or extra Todo mutation tool exists;
- exact annotation contracts;
- exact strict input shapes;
- read structured outputs preserve `TodoPaper | null` L/G shape;
- write structured output has `{ paper, metadata: { committed, idempotent_replay } }`;
- service calls receive only the authenticated user identity resolved by dependencies.

Use `Client` + `InMemoryTransport` like the existing MCP contract tests; do not test implementation internals.

- [ ] **Step 4: Run RED tests and verify failure reason.**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-read-contract.test.ts \
  tests/mcp-write-contract.test.ts \
  tests/todo-mcp-tools.test.ts
```

Expected: failures are caused by missing Todo tools/dependency types and the old five-write contract, not unrelated regressions.

- [ ] **Step 5: Commit the RED contract.**

```bash
git add tests/mcp-read-contract.test.ts tests/mcp-write-contract.test.ts tests/todo-mcp-tools.test.ts
git commit -m "test: define Todo MCP closure contracts"
```

---

## Task 2: Extend the durable idempotency vocabulary and migration

**Files:**
- Modify: `src/domains/mcp-write/mcp-write-idempotency.ts`
- Modify: `src/mcp/tools/write-context.ts`
- Modify: `src/database/schema.ts`
- Modify: `tests/mcp-write-idempotency.test.ts`
- Modify: `tests/todo-schema-migration.test.ts`
- Create: `drizzle/0017_mcp_todo_idempotency.sql`
- Create/modify: `drizzle/meta/0017_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Add RED tests for the scoped schema extension.**

In `tests/mcp-write-idempotency.test.ts` assert:
- the new tool/resource literals are represented in the allowed TypeScript contract;
- existing fingerprint golden values remain unchanged;
- Todo has a golden normalized request hash.

Use this exact normalized Todo request:

```ts
{
  date: "2026-08-13",
  author: "L",
  revision: 3,
  entries: [
    { id: "a", kind: "pending", text: "First" },
    { id: "b", kind: "record", text: "Second" },
  ],
}
```

Expected hash under the existing `leilei-os:mcp-write:v1` version:

```text
088c3e36b755947c59b938b4654845d346926fde71c6d0308459e6083d871aa2
```

In `tests/todo-schema-migration.test.ts`, add a RED migration test requiring `0017_mcp_todo_idempotency.sql` to:
- contain `'write_todo_paper'` and `'todo_paper'`;
- drop/recreate only `mcp_write_idempotency_tool_allowed` and `mcp_write_idempotency_resource_type_allowed`;
- contain no `CREATE TABLE`, `ADD COLUMN`, `DROP COLUMN`, `UPDATE`, `DELETE`, `TRUNCATE`, or Todo table alteration.

- [ ] **Step 2: Extend TypeScript allow-lists.**

In `src/domains/mcp-write/mcp-write-idempotency.ts` add:

```ts
| "write_todo_paper"
```

to `McpIdempotentToolName`, and:

```ts
| "todo_paper"
```

to `McpIdempotentResourceType`.

In `src/mcp/tools/write-context.ts`, append `"write_todo_paper"` to `MCP_WRITE_TOOL_NAMES`.

- [ ] **Step 3: Extend only the existing schema allow-list types/checks.**

In `src/database/schema.ts` update `mcpWriteIdempotency.toolName` and `.resourceType` TypeScript unions and both CHECK expressions. Do not modify columns, indexes, or other tables.

- [ ] **Step 4: Generate migration metadata from the schema.**

Run from repo root:

```bash
pnpm exec drizzle-kit generate --name=mcp_todo_idempotency
```

Require the next migration to be `drizzle/0017_mcp_todo_idempotency.sql`. Inspect generated SQL before continuing. It must only replace the two allow-list CHECK constraints. If Drizzle generates unrelated schema changes, stop and reconcile schema drift rather than accepting them.

- [ ] **Step 5: Run focused migration/idempotency tests and schema check.**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-write-idempotency.test.ts \
  tests/todo-schema-migration.test.ts
pnpm db:check
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add \
  src/domains/mcp-write/mcp-write-idempotency.ts \
  src/mcp/tools/write-context.ts \
  src/database/schema.ts \
  tests/mcp-write-idempotency.test.ts \
  tests/todo-schema-migration.test.ts \
  drizzle/0017_mcp_todo_idempotency.sql \
  drizzle/meta/0017_snapshot.json \
  drizzle/meta/_journal.json
git commit -m "feat: extend MCP idempotency for Todo"
```

---

## Task 3: Add the Todo MCP idempotent domain contract

**Files:**
- Modify: `src/domains/todo/todo-types.ts`
- Modify: `src/domains/todo/todo-service.ts`
- Modify: `tests/todo-service.test.ts`

- [ ] **Step 1: Write RED service tests.**

Extend the fake repository with an MCP-idempotent seam and test:
- same normalization as `replacePaper` (trim IDs/text, drop blank text, preserve order);
- idempotency key is normalized through the shared MCP helper;
- fingerprint includes normalized `{ date, author, revision, entries }`;
- author participates in fingerprint;
- entry order participates in fingerprint;
- invalid key fails before repository mutation;
- repository `idempotency_conflict` maps to a stable Todo idempotency-conflict error;
- repository `revision_conflict` maps to existing `TODO_PAPER_CONFLICT`;
- `committed` and `replayed` map to metadata exactly.

- [ ] **Step 2: Add repository input/result types.**

In `todo-types.ts`, add:

```ts
export type ReplaceTodoPaperIdempotentlyInput = ReplaceTodoPaperInput & {
  idempotencyKey: string;
  requestHash: string;
};

export type ReplaceTodoPaperIdempotentlyResult =
  | { outcome: "committed" | "replayed"; paper: TodoPaper }
  | { outcome: "idempotency_conflict" | "revision_conflict" };
```

Add an optional repository method, matching the Memory pattern so existing non-MCP test doubles are not forced to implement persistence:

```ts
replacePaperIdempotently?(
  input: ReplaceTodoPaperIdempotentlyInput,
): Promise<ReplaceTodoPaperIdempotentlyResult>;
```

- [ ] **Step 3: Refactor normalization once and add the service method.**

Keep existing `replacePaper(...)` behavior byte-for-byte equivalent from callers' perspective. Reuse one normalization/validation path for both Web replace and MCP idempotent replace.

Add a result type equivalent to:

```ts
{
  paper: TodoPaper;
  metadata: {
    committed: boolean;
    idempotent_replay: boolean;
  };
}
```

The MCP method must:
1. validate/normalize date, author, revision, entries;
2. normalize `idempotencyKey` with `normalizeMcpIdempotencyKey`;
3. hash normalized `{ date, author, revision, entries }`;
4. call `repository.replacePaperIdempotently`;
5. safely map repository outcomes.

Add stable service error codes for invalid idempotency key and idempotency conflict. Do not change existing Todo Web error codes.

- [ ] **Step 4: Run service tests.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-service.test.ts
```

Expected: PASS, including all pre-existing Web Todo tests.

- [ ] **Step 5: Commit.**

```bash
git add src/domains/todo/todo-types.ts src/domains/todo/todo-service.ts tests/todo-service.test.ts
git commit -m "feat: add idempotent Todo service write"
```

---

## Task 4: Make Todo mutation + MCP idempotency one atomic transaction

**Files:**
- Modify: `src/domains/todo/todo-repository.ts`
- Modify: `tests/todo-repository.integration.test.ts`
- Modify: `tests/mcp-write-idempotency.integration.test.ts`

- [ ] **Step 1: Add RED PostgreSQL cases before implementation.**

Use disposable/local PostgreSQL only. Add coverage for:
- same user/key/request, six concurrent callers => one paper mutation/revision increment and one idempotency row;
- same key/different hash => `idempotency_conflict`, no mutation;
- different keys/same expected revision => exactly one commit and one `revision_conflict`;
- replay after a later successful paper update => no mutation, current paper returned, replay metadata at service level;
- user isolation for the same key;
- `tool_name='write_todo_paper'`, `resource_type='todo_paper'`, `resource_id=todo_papers.id`;
- forced failure inserting `mcp_write_idempotency` rolls back paper revision/entries;
- forced Todo entry insertion failure creates no idempotency row;
- Todo MCP path creates no `tool_calls` or `resource_lifecycle_events` rows;
- serialized idempotency rows contain no Todo entry text or response snapshot.

- [ ] **Step 2: Extract a transaction-compatible internal replace helper.**

Refactor `DrizzleTodoRepository.replacePaper` so its public behavior remains:

```ts
Promise<
  | { outcome: "committed"; paper: TodoPaper }
  | { outcome: "conflict" }
>
```

Move the actual row lock/create/revision/delete/insert algorithm to a private helper that accepts a Drizzle database/transaction and can also return the `todo_papers.id` internally. Do not duplicate the replacement algorithm.

- [ ] **Step 3: Implement `replacePaperIdempotently`.**

Inside one `this.db.transaction(...)`:

```ts
const idempotency = await lockAndReadMcpIdempotency(transaction, {
  userId: input.userId,
  toolName: "write_todo_paper",
  idempotencyKey: input.idempotencyKey,
});
```

If it exists:
- require matching `requestHash` and `resourceType === "todo_paper"`;
- load the paper by recorded ID + user within the same transaction;
- if missing, throw an internal consistency error;
- return `{ outcome: "replayed", paper }` with no write.

If absent:
- run the internal optimistic replace helper;
- translate its conflict to `revision_conflict`;
- on commit call `recordMcpIdempotency(...)` with the exact paper ID;
- return committed paper.

- [ ] **Step 4: Preserve existing Web repository behavior.**

Run both old and new integration cases against the same repository. Existing `replacePaper` create race, stale revision, empty-paper date semantics, and rollback tests must remain green.

- [ ] **Step 5: Run disposable PostgreSQL integration.**

After applying migrations 0000 through 0017 to a disposable/local database:

```bash
RUN_TODO_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/todo-repository.integration.test.ts
RUN_MCP_WRITE_IDEMPOTENCY_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-write-idempotency.integration.test.ts
```

Expected: PASS. Never point these commands at production.

- [ ] **Step 6: Commit.**

```bash
git add \
  src/domains/todo/todo-repository.ts \
  tests/todo-repository.integration.test.ts \
  tests/mcp-write-idempotency.integration.test.ts
git commit -m "feat: persist Todo MCP idempotency atomically"
```

---

## Task 5: Implement the two Todo read tools

**Files:**
- Create: `src/mcp/tools/read-todo-day/register.ts`
- Create: `src/mcp/tools/list-todo-dates/register.ts`
- Modify: `tests/todo-mcp-tools.test.ts`

- [ ] **Step 1: Implement `read_todo_day`.**

Use a strict Zod input with only `date`. Delegate exactly once to a dependency interface exposing:

```ts
readDay(userId: string, date: string): Promise<{
  date: string;
  papers: TodoDayPapers;
}>;
```

Use the frozen structured output and annotations from the design spec. Map Todo validation errors to bounded safe output and unexpected errors to a generic unavailable message.

- [ ] **Step 2: Implement `list_todo_dates`.**

Use a strict empty input schema. Delegate exactly once to:

```ts
listDates(userId: string): Promise<string[]>;
```

Return `{ success: true, data: { dates } }` with the frozen read-only annotations.

- [ ] **Step 3: Confirm identity and failure boundaries.**

Tests must prove:
- authenticated identity is resolved once per call;
- no user selector is accepted;
- invalid date produces no repository-side read after service rejection;
- internal errors do not leak details.

- [ ] **Step 4: Run focused tests.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-mcp-tools.test.ts
```

At this point read-tool implementation tests should pass; server registration assertions may remain RED until Task 7.

- [ ] **Step 5: Commit.**

```bash
git add \
  src/mcp/tools/read-todo-day/register.ts \
  src/mcp/tools/list-todo-dates/register.ts \
  tests/todo-mcp-tools.test.ts
git commit -m "feat: add Todo MCP read tools"
```

---

## Task 6: Implement `write_todo_paper`

**Files:**
- Create: `src/mcp/tools/write-todo-paper/register.ts`
- Modify: `tests/todo-mcp-tools.test.ts`
- Modify: `tests/mcp-write-contract.test.ts`

- [ ] **Step 1: Define the strict write schema.**

Require:
- `date`: `YYYY-MM-DD` string at transport level; domain performs real-calendar validation;
- `author`: `z.enum(["L", "G"])`;
- `revision`: required `z.number().int().min(0).nullable()`;
- `entries`: ordered array of strict `{ id, kind, text }` objects;
- `idempotency_key`: shared 16–128 ASCII pattern/constants.

Do not add a transport-only rule that changes accepted Web Todo normalization semantics.

- [ ] **Step 2: Define the exact output and annotations.**

Return the service result as:

```ts
{
  success: true,
  data: {
    paper,
    metadata: {
      committed,
      idempotent_replay,
    },
  },
}
```

Annotations are:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}
```

- [ ] **Step 3: Route through `invokeMcpWrite`.**

Use `toolName: "write_todo_paper"`. Resolve authenticated user once, then call the Todo MCP idempotent service method with userId plus the five explicit input fields. Never accept/derive user identity from tool arguments.

- [ ] **Step 4: Implement safe error mapping.**

Distinguish:
- authentication required;
- invalid Todo/idempotency request;
- optimistic Todo paper conflict;
- idempotency conflict;
- unexpected unavailable error.

No error response may include private entry text, SQL, stack, transport detail, or raw internal error messages.

- [ ] **Step 5: Run focused tool/write contracts.**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/todo-mcp-tools.test.ts \
  tests/mcp-write-contract.test.ts
```

Expected: implementation-level Todo write assertions pass; registration-level failures may remain until Task 7.

- [ ] **Step 6: Commit.**

```bash
git add \
  src/mcp/tools/write-todo-paper/register.ts \
  tests/todo-mcp-tools.test.ts \
  tests/mcp-write-contract.test.ts
git commit -m "feat: add Todo MCP write tool"
```

---

## Task 7: Wire Todo into `createMcpServer`

**Files:**
- Modify: `src/mcp/server/create-server.ts`
- Modify: `tests/mcp-read-contract.test.ts`
- Modify: `tests/mcp-write-contract.test.ts`
- Modify: `tests/todo-mcp-tools.test.ts`

- [ ] **Step 1: Add production Todo service construction.**

Import `TodoService` and `DrizzleTodoRepository`, add `defaultTodoService`, and construct it from the same configured database pattern as the existing domain services.

Do not create a second database/client architecture.

- [ ] **Step 2: Add dependency injection seams.**

Add a combined Todo dependency seam sufficient for the two reads plus the idempotent write, plus per-tool overrides only if the existing test architecture genuinely needs them. Keep the type surface smaller than duplicating three unrelated service interfaces.

The production fallback must bind authenticated `userId` from `createMcpServer(..., authenticatedUserId)` exactly like existing tools.

- [ ] **Step 3: Register exactly the three Todo tools.**

Register the two reads and one write once each. Do not change existing tool names/order semantics beyond adding the new tools.

- [ ] **Step 4: Make all Task 1 RED tests GREEN.**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-read-contract.test.ts \
  tests/mcp-write-contract.test.ts \
  tests/todo-mcp-tools.test.ts
```

Require:
- exactly 19 tools;
- exactly six writes;
- exact new read/write annotations;
- no identity inputs;
- no unauthorized extra tool.

- [ ] **Step 5: Commit.**

```bash
git add \
  src/mcp/server/create-server.ts \
  tests/mcp-read-contract.test.ts \
  tests/mcp-write-contract.test.ts \
  tests/todo-mcp-tools.test.ts
git commit -m "feat: register Todo MCP bridge"
```

---

## Task 8: Close the cross-cutting MCP security/privacy/audit regression suite

**Files:**
- Modify: `tests/mcp-read-contract.test.ts`
- Modify: `tests/mcp-write-contract.test.ts`
- Modify: `tests/mcp-write-idempotency.test.ts`
- Modify: `tests/mcp-write-idempotency.integration.test.ts`
- Modify if needed for assertions only: `tests/todo-mcp-tools.test.ts`

- [ ] **Step 1: Audit every tool annotation and identity field.**

Use `client.listTools()` and assert:
- every non-write module read is read-only;
- every name in `MCP_WRITE_TOOL_NAMES` is a write and closed-world;
- `write_todo_paper` is destructive while create-only content writes remain non-destructive and Toy retains its existing destructive annotations;
- no tool schema exposes `userId`/`user_id`.

- [ ] **Step 2: Audit author contracts.**

Assert `author` remains required for:
- `create_task`
- `write_diary`
- `write_memory`
- `write_todo_paper`

Do not add author to Toy or read-only tools.

- [ ] **Step 3: Audit retry/idempotency privacy.**

Assert:
- Todo request fingerprint changes for L↔G, revision changes, entry text/kind/id/order changes;
- same normalized request is stable;
- existing five golden hashes remain unchanged;
- database idempotency row stores only hash/resource identity and cannot match private Todo entry strings or a `response_snapshot`/`payload` field.

- [ ] **Step 4: Audit existing provenance behavior instead of normalizing it.**

In the PostgreSQL integration suite record `tool_calls` and `resource_lifecycle_events` counts before and after a Todo MCP write/replay. Require no increment for Todo. Preserve existing Diary-specific audit assertions untouched.

- [ ] **Step 5: Run all MCP/Todo focused tests.**

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/todo-service.test.ts \
  tests/todo-mcp-tools.test.ts \
  tests/mcp-read-contract.test.ts \
  tests/mcp-write-contract.test.ts \
  tests/mcp-write-idempotency.test.ts \
  tests/todo-schema-migration.test.ts
```

Then run both local PostgreSQL suites from Task 4 again.

- [ ] **Step 6: Commit only if this task adds/changes assertions.**

```bash
git add tests
git commit -m "test: audit final MCP closure boundaries"
```

If no files changed because prior tasks already contain all required assertions, do not create an empty commit.

---

## Task 9: Final feature gate, independent review, and feature-only push

**Files:**
- No planned product-code changes. Fix only evidence-backed defects found by the gate/review.

- [ ] **Step 1: Verify exact scope before the full gate.**

```bash
git fetch origin codex/phase-6-web-ui-foundation feat/mcp-final-closure
git merge-base --is-ancestor e544e9647a26222263ef3bb00d72f319a428a384 HEAD
git diff --name-status e544e9647a26222263ef3bb00d72f319a428a384...HEAD
git status --short
```

Reject unrelated Web/PWA/product changes or preview files.

- [ ] **Step 2: Run the full deterministic suite.**

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
```

Expected: zero failures. Database-gated tests may remain skipped here and are covered separately below.

- [ ] **Step 3: Run disposable/local PostgreSQL migration and integration gates.**

On a disposable database with migration chain through `0017`:

```bash
RUN_TODO_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/todo-repository.integration.test.ts
RUN_MCP_WRITE_IDEMPOTENCY_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-write-idempotency.integration.test.ts
pnpm db:check
```

Require zero failures. Never use production `DATABASE_URL`.

- [ ] **Step 4: Run compile/build/diff gates.**

```bash
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check e544e9647a26222263ef3bb00d72f319a428a384...HEAD
git status --short
```

Expected: PASS; worktree clean except explicitly allowed local-only untracked preview files if they already existed outside the isolated worktree.

- [ ] **Step 5: Perform independent code review against the frozen spec.**

Review specifically for:
- user identity injection/existence leaks;
- author defaulting/inference;
- revision-vs-idempotency ordering;
- nested/non-atomic transaction mistakes;
- same-key concurrent race correctness;
- replay after later revision advancement;
- private payload persistence/logging;
- tool annotation drift;
- unintended Day Space/Calendar or other mutation tools;
- unintended `tool_calls`/lifecycle changes;
- migration scope beyond the two CHECK constraints.

Fix only validated findings, add regression tests, and rerun the affected focused gate plus the full gate.

- [ ] **Step 6: Verify remote base has not moved before feature push.**

```bash
git fetch origin codex/phase-6-web-ui-foundation feat/mcp-final-closure
```

Require `origin/codex/phase-6-web-ui-foundation` still equals the expected accepted base for this package unless the owner explicitly authorizes a rebase/reconciliation. If it moved, stop and reconcile; do not force.

- [ ] **Step 7: Push feature branch non-force only after all gates pass.**

```bash
git push origin HEAD:refs/heads/feat/mcp-final-closure
```

Fetch and verify remote feature SHA equals local HEAD.

- [ ] **Step 8: Stop before merge/production.**

Report:
- feature HEAD SHA;
- exact changed-file scope;
- deterministic test counts;
- PostgreSQL integration results;
- `db:check`, root/Web typecheck/build, diff status;
- migration filename and scope;
- review result;
- `PRODUCTION_TOUCHED=NO`;
- `MERGED=NO`.

Do not merge the feature branch, apply `0017`, deploy, or run production MCP writes without a new explicit authorization.

---

## Implementation self-review checklist

Before declaring the plan executed, confirm every item below is evidenced by code/tests rather than prose:

- [ ] Exactly 19 MCP tools and exactly 6 write tools.
- [ ] Exactly three new Todo tools; no aggregate/extra mutation tool.
- [ ] Todo read tools reuse existing `TodoService` semantics.
- [ ] Todo write requires explicit date/author/revision/entries/idempotency key.
- [ ] Todo write is destructive + idempotent + closed-world in annotations.
- [ ] No user identity is accepted in tool input.
- [ ] Normalized request fingerprint includes date/author/revision/ordered entries.
- [ ] Same-key same-request replay wins before current revision checking.
- [ ] Same-key different-request conflicts.
- [ ] Different-key stale/same-revision races preserve optimistic concurrency.
- [ ] Todo mutation and idempotency row are one transaction.
- [ ] Idempotency replay performs no revision increment.
- [ ] Replay returns current persisted paper state without response snapshots.
- [ ] `0017` changes only idempotency allow-list CHECK constraints.
- [ ] No private Todo text in idempotency/audit persistence.
- [ ] No new Todo `tool_calls` or lifecycle rows.
- [ ] Existing Memory/Diary/Task/Toy/Global Search MCP contracts remain green.
- [ ] Existing Web Todo behavior remains green.
- [ ] No Web/PWA/preview/unrelated changes.
- [ ] Feature only; no merge or production action.