# MCP Response Contract Hygiene Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Phase 1 MCP responses compact, predictable, and easy to route: mutation receipts stay bounded, list/search responses expose deterministic detail retrieval, tool descriptions encode the intended two-stage routing model, and local/weather responses stop duplicating structured JSON in text.

**Architecture:** Keep all business/service semantics unchanged and implement this phase at the MCP registration/response-contract layer. Add one focused contract regression suite at `tests/mcp-response-contract.test.ts`, then make the smallest register-level changes needed to satisfy it. Preserve the existing common success/error envelope and keep later phases—machine-readable error standardization, pagination/count semantics, targeted Universe backend work, and observability—strictly out of scope.

**Tech Stack:** TypeScript, Node.js test runner via `tsx --test`, MCP SDK, pnpm

---

## Scope guardrails

Implementation branch: `plan/mcp-response-contract-hygiene`

Approved design: `docs/superpowers/specs/2026-08-26-mcp-response-contract-hygiene-design.md`

This plan may change MCP register/response metadata and tests only. It must not change database schemas, web code, service-layer business semantics, pagination/count behavior, the existing Notion `UNCERTAIN_WRITE` behavior, Universe storage/query strategy, or observability/logging.

The five mutation tools covered by the compact-receipt work are:

- `write_memory`
- `update_memory`
- `update_diary`
- `create_universe_node`
- `update_universe_node`

The contract suite must verify both required compact fields and forbidden large-body fields. A synthetic body of approximately 100,000 characters must be included so response-size regressions cannot hide behind small fixtures.

## Task 1: Add the Phase 1 contract regression harness

**Files:**
- Create: `tests/mcp-response-contract.test.ts`

### Step 1: Write the failing contract tests

Create a dedicated test file that registers tools against the same lightweight/fake service pattern used by existing MCP tests and captures tool registration metadata plus returned MCP responses.

Add small helpers local to the test file for:

```ts
function getRegisteredTool(name: string) {
  // Return the registered tool metadata + handler from the fake MCP server.
}

function responseData(result: unknown) {
  // Read the current common success envelope's structured payload.
}

function serializedSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
```

Do not introduce a new production helper merely for the tests.

Add RED assertions covering the frozen Phase 1 contract:

1. `write_memory` and `update_memory` return compact receipts containing only identity/status plus:

```ts
{
  detail_tool: "get_memory",
  detail_arguments: { id: "mem_..." }
}
```

and do not expose `description`, `content`, `content_size`, or any other large body fields.

2. `update_diary` returns the date plus:

```ts
{
  detail_tool: "read_diary",
  detail_arguments: { date: "2026-08-26" }
}
```

and does not echo the diary body.

3. `create_universe_node` and `update_universe_node` return compact node identity/status metadata plus the deterministic node-detail tool/arguments and do not echo node content/body.

4. `list_tasks` item(s) expose:

```ts
{
  detail_tool: "get_task",
  detail_arguments: { id: "task_..." }
}
```

without removing existing compact task fields.

5. Successful `search_notion` result(s) expose:

```ts
{
  detail_tool: "read_notion_page",
  detail_arguments: { url: "https://www.notion.so/..." }
}
```

without altering current Notion error/uncertain-write semantics.

6. `get_local_context` and `get_weather_context` keep the structured machine payload in `structuredContent`, but `content` contains exactly one human-readable text block and does not contain a second serialized copy of the structured JSON.

7. Tool descriptions distinguish discovery/browse/detail use and contain the corrected idempotency/argument facts for `write_memory`, `create_task`, and `toy_stop`.

8. Build a `const hugeBody = "x".repeat(100_000)` fixture for mutation-service returns. Assert that each compact mutation response remains below a deliberately conservative ceiling such as 8 KiB after JSON serialization. The test is about response contract boundedness, not the exact byte count.

### Step 2: Verify RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: FAIL because current mutation receipts still include full bodies, task/Notion detail pointers are missing, local/weather text duplicates machine JSON, and at least some descriptions are stale or ambiguous.

If the file cannot compile because the fake service/server setup differs from assumptions, adapt only the test harness to the repository's current MCP registration pattern; do not weaken any contract assertion.

### Step 3: Keep this task test-only

Do not change production code in Task 1. The purpose is to establish a trustworthy RED baseline that subsequent tasks turn green incrementally.

### Step 4: Re-run and record the expected RED categories

Run again:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: the suite executes and fails on contract behavior rather than setup/import errors.

### Step 5: Commit

```bash
git add tests/mcp-response-contract.test.ts
git commit -m "test: add MCP response contract guardrails"
```

## Task 2: Compact Memory mutation receipts and align `write_memory` routing/idempotency metadata

**Files:**
- Modify: `src/mcp/tools/write-memory/register.ts`
- Modify: `src/mcp/tools/update-memory/register.ts`
- Modify: `tests/mcp-response-contract.test.ts`

### Step 1: Tighten the Memory assertions first

In `tests/mcp-response-contract.test.ts`, make the Memory cases explicit for:

- normal active `write_memory`
- normal `update_memory`
- archived/idempotent replay behavior already supported by the service
- a 100,000-character `content`/`description` fixture

For `write_memory`, require the success payload's `data` to be equivalent to:

```ts
{
  id: "mem_123",
  archived: false,
  detail_tool: "get_memory",
  detail_arguments: { id: "mem_123" }
}
```

For an archived result, allow the same receipt shape with `archived: true`; do not require the old full archive/body metadata.

For `update_memory`, require the same retrieval pointer and compact identity/status shape.

Assert forbidden fields are absent from the returned `data`, including at minimum:

```ts
["description", "content", "content_size"]
```

Also assert the huge-body serialized MCP response remains below the Phase 1 ceiling.

### Step 2: Verify Memory RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts --test-name-pattern="Memory|write_memory|update_memory|100k"
```

If this Node/tsx combination does not accept the pattern after the filename, run the whole focused file instead:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: Memory contract cases FAIL on verbose receipts and stale `write_memory` description.

### Step 3: Implement the minimal register-layer receipt mapping

In `src/mcp/tools/write-memory/register.ts`, leave `service.writeMemory(request)` unchanged. Replace only the success-response data mapping so the handler publishes the compact receipt:

```ts
const result = await service.writeMemory(request);

return mcpSuccessResponse({
  id: result.id,
  archived: result.archived,
  detail_tool: "get_memory",
  detail_arguments: { id: result.id },
});
```

Use the repository's current `mcpSuccessResponse` signature exactly; the object above describes the `data` payload, not a new response envelope.

Update the `write_memory` description so it no longer claims the tool is simply non-idempotent. State the actual current behavior: caller-supplied IDs support safe same-operation replay when the service recognizes the same write; after uncertain transport failure, inspect the exact memory with `get_memory` before deciding on a conflicting retry. Keep wording concise and routing-oriented.

In `src/mcp/tools/update-memory/register.ts`, keep `service.updateMemory(...)` untouched and map the success to:

```ts
{
  id: result.id,
  archived: result.archived,
  detail_tool: "get_memory",
  detail_arguments: { id: result.id },
}
```

Do not change validation, idempotency, archive semantics, or errors.

### Step 4: Verify Memory GREEN

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
pnpm check:mcp-write-idempotency
pnpm test:mcp-write-idempotency-integration
```

Expected: Memory contract cases GREEN; idempotency guard/integration checks remain GREEN.

### Step 5: Commit

```bash
git add src/mcp/tools/write-memory/register.ts src/mcp/tools/update-memory/register.ts tests/mcp-response-contract.test.ts
git commit -m "refactor: compact memory mutation receipts"
```

## Task 3: Compact Diary and Universe mutation receipts

**Files:**
- Modify: `src/mcp/tools/update-diary/register.ts`
- Modify: `src/mcp/tools/create-universe-node/register.ts`
- Modify: `src/mcp/tools/update-universe-node/register.ts`
- Modify: `tests/mcp-response-contract.test.ts`

### Step 1: Add/strengthen failing Diary and Universe assertions

Require `update_diary` success `data` to contain the date and deterministic retrieval pointer:

```ts
{
  date: "2026-08-26",
  detail_tool: "read_diary",
  detail_arguments: { date: "2026-08-26" }
}
```

Assert the response does not echo the diary content/body, including when the service result contains approximately 100,000 characters.

For `create_universe_node` and `update_universe_node`, preserve only compact identity/status fields already named by the approved design (for example node `id`, `type`, `category`, and `updated_at` when present in the service result) plus a deterministic detail pointer to `get_universe_node` using the returned node ID. Explicitly forbid content/body fields from the MCP receipt.

Do not invent values when an optional identity/status field is absent; the core requirement is bounded metadata plus the deterministic detail route.

### Step 2: Verify RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: Diary and Universe receipt assertions FAIL while already-fixed Memory assertions stay GREEN.

### Step 3: Implement minimal success mapping in the three registers

In each register, leave request parsing and service calls unchanged. Construct only the compact success payload.

For Diary:

```ts
{
  date: result.date,
  detail_tool: "read_diary",
  detail_arguments: { date: result.date },
}
```

For Universe create/update, return the approved compact identity/status fields and:

```ts
{
  detail_tool: "get_universe_node",
  detail_arguments: { id: result.id },
}
```

Do not alter Universe service queries or hydrate/fetch additional graph data in this phase.

### Step 4: Verify GREEN

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: all compact-receipt and 100k-size cases GREEN.

### Step 5: Commit

```bash
git add src/mcp/tools/update-diary/register.ts src/mcp/tools/create-universe-node/register.ts src/mcp/tools/update-universe-node/register.ts tests/mcp-response-contract.test.ts
git commit -m "refactor: compact diary and universe receipts"
```

## Task 4: Add deterministic detail pointers to Task and Notion discovery results

**Files:**
- Modify: `src/mcp/tools/list-tasks/register.ts`
- Modify: `src/mcp/tools/search-notion/register.ts`
- Modify: `tests/mcp-response-contract.test.ts`

### Step 1: Add failing pointer assertions

For every `list_tasks` item returned by the test fixture, require:

```ts
{
  detail_tool: "get_task",
  detail_arguments: { id: item.id },
}
```

The rest of the existing compact item must stay present; this is additive metadata, not a new Task representation.

For every successful `search_notion` result with a readable page URL, require:

```ts
{
  detail_tool: "read_notion_page",
  detail_arguments: { url: result.url },
}
```

Keep current search fields intact. Add a regression assertion that current Notion error/uncertainty responses are not converted into a new universal error shape.

### Step 2: Verify RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: task/Notion pointer assertions FAIL while prior receipt tests stay GREEN.

### Step 3: Add pointers at result-mapping time

In `src/mcp/tools/list-tasks/register.ts`, extend each existing mapped item only:

```ts
{
  ...existingItem,
  detail_tool: "get_task",
  detail_arguments: { id: item.id },
}
```

In `src/mcp/tools/search-notion/register.ts`, extend successful page results only:

```ts
{
  ...existingResult,
  detail_tool: "read_notion_page",
  detail_arguments: { url: result.url },
}
```

Do not change Notion write/error handling and do not add a fetch/read call to either discovery handler.

### Step 4: Verify GREEN

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: deterministic pointer tests GREEN.

### Step 5: Commit

```bash
git add src/mcp/tools/list-tasks/register.ts src/mcp/tools/search-notion/register.ts tests/mcp-response-contract.test.ts
git commit -m "feat: add MCP detail retrieval pointers"
```

## Task 5: Converge routing descriptions and repair `create_task` / `toy_stop` metadata

**Files:**
- Modify: `src/mcp/tools/global-search/register.ts`
- Modify: `src/mcp/tools/read-memory/register.ts`
- Modify: `src/mcp/tools/search-memory/register.ts`
- Modify: `src/mcp/tools/get-memory/register.ts`
- Modify: `src/mcp/tools/list-tasks/register.ts`
- Modify: `src/mcp/tools/get-task/register.ts`
- Modify: `src/mcp/tools/search-notion/register.ts`
- Modify: `src/mcp/tools/read-notion-page/register.ts`
- Modify: `src/mcp/tools/search-universe/register.ts`
- Modify: `src/mcp/tools/get-universe-node/register.ts`
- Modify: `src/mcp/tools/get-universe-neighborhood/register.ts`
- Modify: `src/mcp/tools/create-task/register.ts`
- Modify: `src/mcp/tools/toy-command/register.ts`
- Modify: `src/mcp/tools/write-memory/register.ts`
- Modify: `tests/mcp-response-contract.test.ts`

### Step 1: Write description-contract assertions before editing descriptions

Capture the registered tool descriptions and assert the following routing facts semantically (prefer stable required phrases/keywords over brittle full-string equality):

- `global_search`: fallback when the domain is unknown; domain-specific search/browse should be preferred once the domain is known.
- `read_memory`: compact browse/directory/category/known-key retrieval without requiring keywords; not full Memory body retrieval.
- `search_memory`: keyword discovery inside Memory; compact matches; next detail route is `get_memory`.
- `get_memory`: full detail after an exact Memory ID is known; not the primary discovery tool.
- `list_tasks`: compact Task listing; `get_task` is the detail route.
- `get_task`: full/specific task retrieval by exact task ID.
- `search_notion`: page discovery; `read_notion_page` is the content/detail route.
- `read_notion_page`: read a selected page after URL/page identity is known; not general discovery.
- `search_universe`: compact Universe discovery; exact selected nodes go to `get_universe_node`.
- `get_universe_node`: exact node detail by ID.
- `get_universe_neighborhood`: relationship/neighborhood expansion around a known node; not global discovery.
- `write_memory`: description matches current replay/idempotency behavior and directs uncertain-write verification to `get_memory`.
- `create_task`: description matches the tool's actual idempotent/replay semantics rather than calling it non-idempotent.
- `toy_stop`: registered under `src/mcp/tools/toy-command/register.ts`; its description must state that `idempotency_key` is required and must not claim the stop action takes no arguments.

Do not require every tool to use identical prose. The contract is that the model can distinguish when to use it, when not to use it, whether it is compact/full, and the usual next tool where relevant.

### Step 2: Verify RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: at least the known stale `create_task`, `toy_stop`, and routing-description assertions FAIL.

### Step 3: Edit descriptions only

Update the `description` strings in the listed register files. Do not change tool names, schemas, required arguments, handlers, service calls, or result shapes in this task.

Keep descriptions concise. Favor a consistent pattern such as:

```text
Use when ... Returns compact ... Do not use when ... For full detail, call ...
```

For `global_search`, explicitly make it the cross-domain fallback rather than the preferred first call for a domain that is already known.

For `create_task`, describe the idempotency/replay contract that the current implementation already enforces; do not modify that implementation.

For `toy_stop`, inspect its existing input schema in `src/mcp/tools/toy-command/register.ts` and make the description agree with the already-required `idempotency_key`.

### Step 4: Verify GREEN and schema stability

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
pnpm check:mcp-write-idempotency
pnpm test:mcp-write-idempotency-integration
```

Expected: description assertions GREEN; idempotency checks remain GREEN, proving metadata edits did not alter semantics.

### Step 5: Commit

```bash
git add src/mcp/tools/global-search/register.ts src/mcp/tools/read-memory/register.ts src/mcp/tools/search-memory/register.ts src/mcp/tools/get-memory/register.ts src/mcp/tools/list-tasks/register.ts src/mcp/tools/get-task/register.ts src/mcp/tools/search-notion/register.ts src/mcp/tools/read-notion-page/register.ts src/mcp/tools/search-universe/register.ts src/mcp/tools/get-universe-node/register.ts src/mcp/tools/get-universe-neighborhood/register.ts src/mcp/tools/create-task/register.ts src/mcp/tools/toy-command/register.ts src/mcp/tools/write-memory/register.ts tests/mcp-response-contract.test.ts
git commit -m "refactor: align MCP tool routing metadata"
```

## Task 6: Remove duplicate JSON from local/weather text output

**Files:**
- Modify: `src/mcp/tools/get-local-context/register.ts`
- Modify: `src/mcp/tools/get-weather-context/register.ts`
- Modify: `tests/mcp-response-contract.test.ts`

### Step 1: Strengthen response-channel assertions

For both local and weather context tools, assert:

- `structuredContent` still contains the current structured machine payload.
- `content` contains exactly one item with `type: "text"`.
- that text is the existing useful human-readable summary, not `JSON.stringify(structuredContent)` or a raw structured dump.
- representative JSON keys/serialized object fragments do not appear as an appended second copy in text.

Do not assert cosmetic prose beyond what is necessary to prevent duplication.

### Step 2: Verify RED

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: local/weather duplicate-output assertions FAIL on the current responses.

### Step 3: Remove only the redundant serialized JSON text

In both register files, preserve the current structured object and current human-readable summary. Return the structured object through `structuredContent` and exactly one text block through `content`.

Conceptually:

```ts
return {
  structuredContent,
  content: [
    {
      type: "text",
      text: humanReadableSummary,
    },
  ],
};
```

Use the project's existing response helper/envelope rather than introducing a parallel MCP response format.

Do not change geolocation/weather lookup behavior, cache behavior, source selection, or data semantics.

### Step 4: Verify GREEN

Run:

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: response-channel assertions GREEN and the rest of the Phase 1 contract suite remains GREEN.

### Step 5: Commit

```bash
git add src/mcp/tools/get-local-context/register.ts src/mcp/tools/get-weather-context/register.ts tests/mcp-response-contract.test.ts
git commit -m "refactor: normalize local context responses"
```

## Task 7: Run full Phase 1 acceptance and enforce scope

**Files:**
- Verify only; modify files only if a Phase 1 regression is found.

### Step 1: Run the focused contract regression

```bash
pnpm exec tsx --test tests/mcp-response-contract.test.ts
```

Expected: PASS, including the ~100k-body bounded-response regression.

### Step 2: Run the repository test suite

```bash
pnpm test
```

Expected: PASS.

### Step 3: Build the project

```bash
pnpm build
```

Expected: PASS with no TypeScript/build errors.

### Step 4: Re-run write-idempotency verification

```bash
pnpm check:mcp-write-idempotency
pnpm test:mcp-write-idempotency-integration
```

Expected: PASS. This is especially important because Phase 1 changes Memory/Task metadata and response contracts but must not change write semantics.

### Step 5: Inspect the implementation diff for forbidden scope creep

Run:

```bash
git diff --stat plan/mcp-response-contract-hygiene~0..HEAD
git diff --name-only HEAD~6..HEAD
```

If the exact commit count differs because of rebases or fixup commits, compare against the implementation starting commit instead of relying on `HEAD~6`.

Confirm there are no changes to:

- Prisma/database schema or migrations
- `apps/web/**`
- service-layer business rules
- pagination/count semantics
- universal/machine-readable error-envelope behavior
- Universe targeted-backend/query architecture
- observability/logging implementation

Also confirm the existing Notion `UNCERTAIN_WRITE` behavior remains untouched.

### Step 6: Final acceptance record

Before declaring Phase 1 implemented, record the exact command results for:

```text
pnpm exec tsx --test tests/mcp-response-contract.test.ts
pnpm test
pnpm build
pnpm check:mcp-write-idempotency
pnpm test:mcp-write-idempotency-integration
```

Do not claim completion if any command is red. Fix only failures caused by this Phase 1 implementation; pre-existing unrelated failures must be reported separately rather than silently broadened into new scope.

No additional commit is required for a clean verification-only task. If verification requires a Phase 1 fix, use a narrowly scoped commit message describing that fix and rerun all five acceptance commands.
