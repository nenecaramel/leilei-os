# MCP Todo Action Copy Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate whether ChatGPT's refusal to invoke `write_todo_paper` is influenced by the tool's user-facing title/description by changing only those two metadata strings and verifying all frozen behavior remains unchanged.

**Architecture:** Keep the existing `write_todo_paper` tool name, schemas, annotations, authentication, service/repository code, revision semantics, idempotency semantics, and database unchanged. Make the smallest metadata-only edit in the tool registration file, then verify it with the existing MCP/Todo contract tests plus an uncommitted metadata probe. After verification, deploy only the exact experiment commit to the accepted branch and refresh ChatGPT's tool metadata for one minimal production invocation test.

**Tech Stack:** TypeScript, Node test runner, Model Context Protocol SDK, Zod, pnpm, Git.

## Global Constraints

- Runtime/source change is limited to the user-facing `title` and `description` metadata for `write_todo_paper`; documentation may include this spec and plan.
- Do not commit test-source changes for the experiment; verification uses the existing test suite and an uncommitted metadata probe.
- Tool name remains exactly `write_todo_paper`.
- Input schema and output schema remain semantically unchanged.
- `destructiveHint` remains `true`; `idempotentHint` remains `true`; `readOnlyHint` remains `false`; `openWorldHint` remains `false`.
- Authentication, Todo service/repository behavior, revision semantics, idempotency semantics, database schema, migrations, and every other MCP tool remain unchanged.
- Proposed title is exactly `Save one Todo paper`.
- Proposed description is exactly `Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.`
- Production deployment is an experiment only; if ChatGPT still stops before emitting the tool call, revert the copy experiment and investigate another client/tool-metadata difference.

---

### Task 1: Change only the Todo write presentation metadata

**Files:**
- Modify: `src/mcp/tools/write-todo-paper/register.ts`

**Interfaces:**
- Consumes: existing MCP `write_todo_paper` registration.
- Produces: the same tool surface and behavior, with only `title` and `description` changed to the approved neutral copy.

- [ ] **Step 1: Verify the current metadata is still the old copy**

Run from repository root:

```bash
grep -n -A4 -B2 'title: "Replace one Todo paper"' src/mcp/tools/write-todo-paper/register.ts
```

Expected: the current title is `Replace one Todo paper` and the description contains the existing full-replacement wording. Stop if the file has drifted.

- [ ] **Step 2: Make the minimal tool-registration edit**

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

Do not change the input schema, output schema, annotations, handler, error mapping, imports, or any other runtime code.

- [ ] **Step 3: Run focused behavioral and contract verification**

Run:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/todo-mcp-tools.test.ts
pnpm exec tsx --test --test-concurrency=1 tests/mcp-read-contract.test.ts tests/mcp-write-contract.test.ts tests/todo-mcp-tools.test.ts
pnpm typecheck
pnpm build
git diff --check
```

Expected: all PASS. The existing tests verify the frozen tool inventory, annotations, schemas, server-owned identity, write delegation, safe errors, and Todo behavior remain unchanged.

- [ ] **Step 4: Run an uncommitted metadata probe**

Run from repository root:

```bash
node --input-type=module <<'NODE'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./dist/mcp/server/create-server.js";

const server = createMcpServer({}, "00000000-0000-4000-8000-000000000099");
const client = new Client({ name: "todo-copy-probe", version: "1.0.0" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
const tool = (await client.listTools()).tools.find((candidate) => candidate.name === "write_todo_paper");
if (!tool) throw new Error("write_todo_paper missing");
if (tool.title !== "Save one Todo paper") throw new Error(`unexpected title: ${tool.title}`);
const expectedDescription = "Save one complete L or G Todo paper in Leilei OS. Supply an exact YYYY-MM-DD date, the logical author, the exact current revision returned by read_todo_day (or null only when creating a missing paper), the complete ordered entry list, and a stable idempotency key. The authenticated user is assigned by the server.";
if (tool.description !== expectedDescription) throw new Error(`unexpected description: ${tool.description}`);
const expectedAnnotations = JSON.stringify({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
if (JSON.stringify(tool.annotations) !== expectedAnnotations) throw new Error(`annotations drifted: ${JSON.stringify(tool.annotations)}`);
console.log("TODO_ACTION_COPY_METADATA=PASS");
await client.close();
await server.close();
NODE
```

Expected: `TODO_ACTION_COPY_METADATA=PASS`.

- [ ] **Step 5: Verify the diff is experiment-only**

Run:

```bash
git diff --name-only 51922634319070560660ccedc975cc56c8959d91...HEAD
git diff 51922634319070560660ccedc975cc56c8959d91...HEAD -- src/mcp/tools/write-todo-paper/register.ts
```

Expected source/runtime diff: only the exact title/description change in `src/mcp/tools/write-todo-paper/register.ts`, plus the approved spec/plan documents. No test source, database, migration, repository, service, Web, PWA, or other MCP-tool files may change.

- [ ] **Step 6: Commit the verified implementation**

```bash
git add src/mcp/tools/write-todo-paper/register.ts
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
