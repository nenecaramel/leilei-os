# MCP Final Closure Design

> Historical/superseded package. The Todo MCP closure described here is
> already represented in the current `main` tree; its old branch, migration
> checkpoint, and tool-count assertions are implementation history only.

Date: 2026-08-13
Base: `codex/phase-6-web-ui-foundation` at `e544e9647a26222263ef3bb00d72f319a428a384`
Implementation branch: `feat/mcp-final-closure`

## 1. Goal

Close the current MCP bridge against the accepted Leilei OS product contracts without expanding the product surface beyond the missing Todo bridge.

This package adds exactly three Todo MCP tools:
- `read_todo_day`
- `list_todo_dates`
- `write_todo_paper`

It also performs the final cross-cutting MCP contract audit for authenticated identity, L/G author handling, tool annotations, persistent idempotency, safe errors, privacy, and existing audit/provenance boundaries.

The accepted Web Todo, Day Space, and Calendar contracts remain authoritative. MCP reuses the Todo domain rather than creating a second Todo model or a Day Space/Calendar aggregate domain.

## 2. Product invariants

1. The MCP tool count increases from 16 to exactly 19. Only the three Todo tools above are added.
2. The MCP write-tool count increases from five to exactly six. The only new write is `write_todo_paper`.
3. MCP user identity always comes from authenticated server context. No Todo MCP input may accept `user_id`, `userId`, account identity, OAuth subject, or another user selector.
4. `author` on a Todo paper is logical content ownership and must be exactly `L` or `G`. It is not authentication, authorization, provenance, or audit actor identity.
5. `read_todo_day` exposes the same L/G day papers as the existing Todo domain. `list_todo_dates` exposes the same content-bearing dates used by the accepted Calendar semantics; an existing empty paper does not make a date appear.
6. `write_todo_paper` is the same whole-paper replace contract as Web Todo: explicit business date, explicit author, explicit expected revision, and the complete ordered entry list.
7. Optimistic concurrency remains authoritative. A new idempotency key with a stale revision must fail with a Todo paper conflict and must not persist an idempotency record.
8. Persistent idempotency is authoritative for retry safety. The same user/tool/key with the same normalized request is a no-op replay; the same key with different normalized input is an idempotency conflict.
9. Idempotency lookup happens before optimistic-revision mutation logic so a legitimate retry of an already committed request does not fail merely because the paper revision has advanced later.
10. No private Todo entry text, request payload, or response snapshot is stored in `mcp_write_idempotency`; only the existing request hash and resource identity pattern is extended.
11. No `get_day_space`, `list_calendar_dates`, Calendar marker, aggregate day, Todo entry-level mutation, edit/archive/restore/delete tool, or generic entity mutation is added.
12. Memory, Diary, Task, Toy, Global Search, Web API, PWA, Day Space, Calendar, and existing lifecycle behavior do not gain new product capabilities in this package.

## 3. Current gap

The accepted Todo domain already owns:
- exact-date day reads through `TodoService.readDay`;
- content-bearing date discovery through `TodoService.listDates`;
- whole-paper optimistic replacement through `TodoService.replacePaper` and `DrizzleTodoRepository.replacePaper`.

The accepted MCP server does not instantiate `TodoService`, expose Todo dependencies, or register Todo tools.

The existing persistent MCP idempotency layer currently permits only:
- tools: `create_task`, `write_diary`, `write_memory`, `toy_set`, `toy_stop`;
- resource types: `task`, `diary_entry`, `memory`, `toy_command`.

Therefore Todo write support requires a scoped extension of both TypeScript unions and the database CHECK constraints. This is a new migration after `0016_todo_foundation.sql`; it is not a new business table or a Todo schema redesign.

## 4. Todo MCP read contracts

### `read_todo_day`

Input:
```ts
{
  date: string; // exact YYYY-MM-DD
}
```

The input schema is strict. Relative dates and user identity fields are not accepted.

Successful structured output:
```ts
{
  success: true;
  data: {
    date: string;
    papers: {
      L: TodoPaper | null;
      G: TodoPaper | null;
    };
  };
}
```

Each non-null `TodoPaper` contains:
```ts
{
  author: "L" | "G";
  date: string;
  revision: number;
  entries: Array<{
    id: string;
    kind: "pending" | "completed" | "record";
    text: string;
  }>;
}
```

Annotations:
```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

The tool calls `TodoService.readDay` with the authenticated user ID and the requested date. It does not duplicate Todo validation or query tables directly.

### `list_todo_dates`

Input is a strict empty object.

Successful structured output:
```ts
{
  success: true;
  data: {
    dates: string[];
  };
}
```

Dates are the sorted, distinct content-bearing dates already returned by `TodoService.listDates`. The tool does not add month filtering, L/G filtering, entry counts, Diary unioning, or Calendar marker semantics of its own.

Annotations are the same read-only annotations as `read_todo_day`.

## 5. `write_todo_paper` contract

Input:
```ts
{
  date: string;
  author: "L" | "G";
  revision: number | null;
  entries: Array<{
    id: string;
    kind: "pending" | "completed" | "record";
    text: string;
  }>;
  idempotency_key: string;
}
```

All five fields are required, including `revision`. `revision: null` is the explicit create contract for a missing paper. Existing papers require the exact current non-negative integer revision.

The tool schema is strict and does not expose user identity.

Successful structured output:
```ts
{
  success: true;
  data: {
    paper: TodoPaper;
    metadata: {
      committed: boolean;
      idempotent_replay: boolean;
    };
  };
}
```

For a first successful application:
```ts
{ committed: true, idempotent_replay: false }
```

For a same-key/same-request replay:
```ts
{ committed: false, idempotent_replay: true }
```

Annotations:
```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}
```

`destructiveHint` is true because whole-paper replacement can remove or replace existing entries even though it does not delete the Todo paper resource itself.

## 6. Normalization and request fingerprint

`TodoService` remains the domain validation boundary. The MCP write must reuse the same normalized Todo values as the actual mutation:
- date must be a real calendar date in `YYYY-MM-DD` form;
- author must be `L` or `G`;
- revision must be `null` or a non-negative integer;
- each entry ID is trimmed and non-empty;
- entry kind is one of the three accepted Todo kinds;
- entry text is trimmed;
- blank-text entries are omitted exactly as the existing Todo service does;
- duplicate normalized entry IDs are rejected;
- entry order is preserved.

After normalization, the persistent MCP request hash is computed over exactly:
```ts
{
  date,
  author,
  revision,
  entries,
}
```

`idempotency_key` is not included in the request hash because it is already part of the persistent idempotency identity. Authenticated `userId` and tool name are likewise separate dimensions in the idempotency key.

The existing canonical SHA-256 fingerprint version remains unchanged. Adding Todo does not require a global fingerprint-version bump because existing golden fingerprints and normalization for existing tools do not change.

## 7. Domain and repository idempotency semantics

Add a dedicated MCP-safe domain method such as `TodoService.replacePaperIdempotently(...)`. The existing Web-facing `replacePaper(...)` remains unchanged in behavior.

The Todo repository gains an idempotent replace capability that runs one database transaction with this order:

1. Acquire/read the existing MCP idempotency advisory lock for `(userId, "write_todo_paper", idempotencyKey)`.
2. If an idempotency row exists:
   - mismatched request hash or resource type => idempotency conflict;
   - matching hash + `todo_paper` resource => read the persisted paper by the recorded resource ID and authenticated user, perform no mutation, return replay.
3. If no idempotency row exists, execute the existing optimistic whole-paper replace logic inside the same transaction.
4. On revision/create conflict, return the existing Todo paper conflict and write no idempotency row.
5. On successful mutation, insert one `mcp_write_idempotency` row with:
   - `tool_name = 'write_todo_paper'`
   - `resource_type = 'todo_paper'`
   - `resource_id = todo_papers.id`
   - the normalized request hash.
6. Commit business mutation and idempotency record together.

Do not call the current transaction-owning `replacePaper` from inside another transaction. Refactor the repository's actual replace operation into a transaction-compatible internal helper and keep the public Web `replacePaper` wrapper behavior identical.

### Replay after later mutations

The idempotency table intentionally does not store response snapshots or private entry payloads. Therefore a valid replay reads and returns the current persisted target paper identified by the original `todo_papers.id`, marks `idempotent_replay: true`, and performs no new write.

This matches the existing project precedent that idempotent replay may return the resource's current persisted state after later lifecycle/content changes rather than a historical response snapshot.

## 8. Concurrency rules

Required behavior:
- six concurrent same-user/same-key/same-request Todo writes create or replace the paper exactly once and produce exactly one idempotency row;
- the remaining callers replay without a second revision increment;
- same key + different normalized request conflicts without mutating the paper;
- different keys + same expected revision race through the Todo row lock: exactly one can commit, and the loser receives `TODO_PAPER_CONFLICT` with no idempotency row;
- idempotency is isolated by authenticated user and tool name;
- a replay is checked before revision validation against current persisted state, so a committed retry remains a replay even after later revision advancement.

## 9. Database migration

Update the Drizzle schema's `mcp_write_idempotency` TypeScript types and CHECK constraints to include:
- tool name `write_todo_paper`;
- resource type `todo_paper`.

Generate the next migration after `0016_todo_foundation.sql` as `0017_mcp_todo_idempotency.sql` with matching Drizzle metadata.

The migration is intentionally narrow:
- drop the two existing allow-list CHECK constraints;
- recreate them with the one additional tool and resource type;
- create no table;
- add/drop no column;
- update/delete/backfill no business row;
- change no Todo paper/entry schema;
- change no existing idempotency row.

## 10. Authentication, author, permissions, and safe errors

All three Todo tools derive `userId` from the same authenticated MCP server context used by the existing tools.

No tool accepts a user selector. Cross-user reads, writes, and idempotency replays remain impossible through tool input.

`write_todo_paper` requires explicit author even though the route already names one paper. The server never guesses L/G from ChatGPT, MCP, OAuth, account, current day, previous paper, or previous call.

Safe tool error mapping:
- missing authenticated context => authentication-required error;
- invalid date/author/revision/entry/idempotency key => bounded invalid-request error;
- stale revision/create race => safe Todo paper changed/conflict error;
- same idempotency key with different request => explicit idempotency-conflict error;
- unexpected internal failure => generic temporary-unavailable error with no SQL, transport, stack, or private entry detail.

Tool implementations do not retry writes automatically.

## 11. Audit and provenance boundary

This package audits the existing MCP boundary; it does not invent a new generic audit product.

Preserve current distinctions:
- `author` is content ownership;
- authenticated MCP user is authorization identity;
- `channel/source` are technical provenance where those domains already use them;
- `tool_calls` and `resource_lifecycle_events` keep their existing historical/domain-specific semantics;
- `mcp_write_idempotency` is durable retry safety, not a private-content audit log.

`write_todo_paper` does not create `tool_calls` or `resource_lifecycle_events`. Todo has no lifecycle transition in this operation, and the current project does not have a universal `tool_calls` contract for every MCP write. The final MCP audit must preserve existing Diary-specific audit behavior rather than normalizing all tools into a new audit subsystem.

No new audit row may copy Todo entry text merely to describe the MCP call.

## 12. Server wiring

`createMcpServer` gains a default `TodoService` backed by `DrizzleTodoRepository` and dependency-injection seams for Todo reads and write tests.

Register exactly:
- `read_todo_day`
- `list_todo_dates`
- `write_todo_paper`

The existing sixteen tools retain their current names and behavior.

Update `MCP_WRITE_TOOL_NAMES` to include `write_todo_paper` so cross-cutting write-contract tests and write context remain one source of truth.

No Web routing, client UI, PWA code, Day Space composition, or Calendar composition changes are needed.

## 13. Testing strategy

Implementation is TDD-first.

### Tool contracts
- Todo read tools are registered with exact read-only annotations;
- Todo write is registered with destructive/idempotent/closed-world write annotations;
- total MCP tools = 19 and write tools = 6;
- no MCP tool exposes `user_id` or `userId`;
- `write_todo_paper` requires author, revision, entries, date, and idempotency key;
- invalid identity injection is rejected before auth/service calls;
- failures are sanitized and never automatically retried;
- no Day Space/Calendar aggregate or additional mutation tool appears.

### Todo read/write unit contracts
- `read_todo_day` delegates one authenticated call to `TodoService.readDay` and returns L/G papers unchanged;
- `list_todo_dates` delegates one authenticated call to `TodoService.listDates` and preserves sorted content dates;
- write normalizes and persists exact L/G/entries/order;
- missing/invalid author, date, revision, entry, duplicate ID, and idempotency key fail before mutation;
- stale revision maps to Todo conflict;
- idempotency conflict maps separately;
- successful first write and replay expose correct metadata.

### Persistent idempotency / PostgreSQL
- same-key/same-request concurrency mutates once and records one idempotency row;
- replay after later paper revision is a no-op and returns current paper state;
- same-key/different-request conflicts;
- different-key/same-revision race yields one commit and one revision conflict;
- user isolation and tool isolation hold;
- failure while recording idempotency rolls back the Todo mutation;
- failure during Todo mutation creates no idempotency row;
- idempotency table contains no private entry payload or response snapshot;
- Todo MCP write creates no `tool_calls` or lifecycle rows.

### Migration
- `0017_mcp_todo_idempotency.sql` changes only the two allow-list CHECK constraints;
- existing five tool names/four resource types remain allowed;
- `write_todo_paper` / `todo_paper` become allowed;
- no CREATE TABLE, ADD/DROP COLUMN, UPDATE, DELETE, TRUNCATE, or business-data backfill appears;
- Drizzle schema, snapshot, and journal match the migration;
- `pnpm db:check` passes.

### Regression gates
- existing Todo Web API/service/repository tests remain unchanged in semantics;
- existing Memory/Diary/Task/Toy/Global Search MCP contracts stay green;
- existing MCP fingerprint golden values remain unchanged;
- full deterministic suite, database integration, root/web typecheck/build, and `git diff --check` pass.

## 14. Explicit non-goals

Not part of this package:
- `get_day_space` or any cross-domain day aggregate;
- Calendar-specific MCP tool or marker API;
- Todo entry-level create/update/delete tools;
- Memory/Diary/Task edit/archive/restore/delete MCP tools;
- generic `get_entity`;
- author inference/defaulting;
- new audit product or universal `tool_calls` logging;
- Web/PWA UI changes;
- permanent delete;
- export/import/recovery work;
- Phase 7.3 Timeline/events;
- PWA 7.6B;
- Universe.

## 15. Feature acceptance and production boundary

The implementation branch may include the new `0017` migration file but must not apply it to production during implementation.

Feature acceptance requires:
- exact branch/base verification;
- focused TDD evidence;
- full deterministic tests;
- real disposable/local PostgreSQL migration + Todo/MCP idempotency integration coverage;
- `pnpm db:check`;
- root and Web typecheck/build;
- `git diff --check`;
- clean scoped diff;
- independent review of auth, author, idempotency, safe-error, privacy, and no-scope-expansion contracts.

Production rollout is a separate explicit authorization step. Because `0017` changes production database constraints, rollout must reuse the project's migration safety procedure: fresh accepted SHA verification, fresh encrypted backup, restore verification, migration, schema/data checks, deployment status, authenticated MCP smoke, and only then production acceptance.
