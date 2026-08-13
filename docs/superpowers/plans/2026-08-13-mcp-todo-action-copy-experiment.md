# MCP Todo Action Copy Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate whether ChatGPT's refusal to invoke `write_todo_paper` is influenced by the tool's user-facing title/description by changing only those two metadata strings and verifying all frozen behavior remains unchanged.

**Architecture:** Keep the existing `write_todo_paper` tool name, schemas, annotations, authentication, service/repository code, revision semantics, idempotency semantics, and database unchanged. Add one contract assertion for the proposed neutral metadata, then make the smallest matching edit in the tool registration file. After local verification, deploy only the exact experiment commit to the accepted branch and refresh ChatGPT's tool metadata for one minimal production invocation test.

**Tech Stack:** TypeScript, Node test runner, Model Context Protocol SDK, Zod, pnpm, Git.

## Global Constraints

- Change only the user-facing `title` and `description` metadata for `write_todo_paper` plus this spec/plan and the focused contract assertion.
- Tool name remains exactly `write_todo_paper`.
- Input schema and output schema remain byte-for-byte semantically unchanged.
- `destructiveHint` remains `true`; `idempotentHint` remains `true`; `readOnlyHint` remains `false`; `openWorldHint` remains `false`.
- Authentication, Todo service/repository behavior, revision semantics, idempotency semantics, database schema, migrations, and every other MCP tool remain unchanged.
- Proposed title is exactly `Save one Todo paper`.
- Proposed description is exactly `Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.`
- Production deployment is an experiment only; if ChatGPT still stops before emitting the tool call, revert the copy experiment and investigate another client/tool-metadata difference.

---

### Task 1: Freeze and change only the Todo write presentation metadata

**Files:**
- Modify: `tests/todo-mcp-tools.test.ts`
- Modify: `src/mcp/tools/write-todo-paper/register.ts`

**Interfaces:**
- Consumes: MCP `listTools()` metadata for the existing `write_todo_paper` registration.
- Produces: The same `write_todo_paper` tool surface and behavior, with only `title` and `description` changed to the approved neutral copy.

- [ ] **Step 1: Add a failing contract assertion for the exact metadata**

In the existing test `Todo exposes exactly the frozen three-tool MCP surface`, immediately after `assert.ok(write);`, add:

```ts
  assert.equal(write.title, "Save one Todo paper");
  assert.equal(
    write.description,
    "Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.",
  );
```

Do not alter the existing annotation/schema assertions around it.

- [ ] **Step 2: Run the focused test and verify RED**

Run from repository root:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-mcp-tools.test.ts
```

Expected: FAIL only because the current tool title/description still use the old `Replace one complete Todo paper` copy. Existing tool behavior tests should otherwise continue executing normally.

- [ ] **Step 3: Make the minimal tool-registration edit**

In `src/mcp/tools/write-todo-paper/register.ts`, replace only:

```ts
      title: "Replace one Todo paper",
      description:
        "Replace one complete L or G Todo paper for an exact date after the user approves the full ordered entry list. revision must be null only when creating a missing paper; otherwise pass the exact current revision returned by read_todo_day.",
```

with exactly:

```ts
      title: "Save one Todo paper",
      description:
        "Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.",
```

Do not change the input schema, output schema, annotations, handler, error mapping, imports, or any other file behavior.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-mcp-tools.test.ts
```

Expected: PASS.

Then run the MCP contract gates:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/mcp-read-contract.test.ts tests/mcp-write-contract.test.ts tests/todo-mcp-tools.test.ts
pnpm typecheck
pnpm build
git diff --check
```

Expected: all PASS with no schema/annotation/inventory regressions.

- [ ] **Step 5: Verify the diff is experiment-only**

Run:

```bash
git diff --name-only 51922634319070560660ccedc975cc56c8959d91...HEAD
git diff 51922634319070560660ccedc975cc56c8959d91...HEAD -- src/mcp/tools/write-todo-paper/register.ts tests/todo-mcp-tools.test.ts
```

Expected implementation diff: only the exact title/description change and the exact metadata assertions, plus the already approved spec/plan documents. No database, migration, repository, service, Web, PWA, or other MCP-tool files may change.

- [ ] **Step 6: Commit the verified implementation**

```bash
git add src/mcp/tools/write-todo-paper/register.ts tests/todo-mcp-tools.test.ts
git commit -m "fix: neutralize Todo MCP action copy"
```

Record the exact implementation SHA.

### Task 2: Deploy the experiment and perform one minimal production invocation probe

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: verified experiment commit from Task 1.
- Produces: production evidence answering only whether ChatGPT now emits a `write_todo_paper` tool call.

- [ ] **Step 1: Re-verify accepted branch and experiment ancestry**

Run:

```bash
git fetch origin codex/phase-6-web-ui-foundation fix/mcp-todo-action-copy-experiment
```

Require accepted branch HEAD to still equal `51922634319070560660ccedc975cc56c8959d91` and require the experiment branch to be a fast-forward descendant. Stop if either ref drifted.

- [ ] **Step 2: Fast-forward accepted branch without force**

Push the exact verified experiment SHA to `codex/phase-6-web-ui-foundation` with a normal fast-forward update. Do not create a merge commit and do not force-push.

- [ ] **Step 3: Wait for deployment status on the exact experiment SHA**

Require both GitHub deployment statuses to be `success`:

- `Vercel`
- `carefree-spontaneity - leilei-os`

Do not run the production probe while either status is absent, pending, or failing.

- [ ] **Step 4: Refresh ChatGPT tool metadata**

In ChatGPT plugin settings for `leileios`, refresh/upgrade the tool metadata so the visible `write_todo_paper` title reads `Save one Todo paper` and the description matches the approved copy.

- [ ] **Step 5: Run one minimal authenticated production probe**

Use a fresh chat with `leileios`:

1. Call `list_todo_dates` and choose the latest date.
2. Call `read_todo_day` for that date and choose one non-null paper.
3. Explicitly approve the exact unchanged ordered entries from that read.
4. Attempt exactly one `write_todo_paper` call using the current revision, unchanged entries, and a new stable idempotency key.

Success criterion for this experiment: ChatGPT emits the tool call and the Leilei OS server returns a tool result. The result may then be evaluated under the previously frozen Todo write smoke semantics.

If ChatGPT still stops before emitting the tool call, do not retry repeatedly and do not alter Todo data. Record the client-side stop as evidence, revert only the copy experiment on the accepted branch, redeploy, and continue diagnosis with another metadata/tool-difference hypothesis.
