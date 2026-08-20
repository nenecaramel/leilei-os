# MCP Session Capacity Diagnostics Implementation Plan

> Diagnostic-only production observability pass. Do not change admission, eviction, TTL, capacity, protocol, or MCP tool behavior in this plan.

**Goal:** Determine from safe production evidence whether ChatGPT's rapidly accumulating MCP sessions are idle/orphaned or still in-flight when per-user capacity is exhausted.

**Base:** `edf9df84c6e218f95d1970c86290a775e67eba58` (`main`, PR #195 merge)

**Branch:** `maintenance/mcp-session-capacity-diagnostics`

**Current production symptom:** after a process restart the process-local registry starts at 0, then ChatGPT can create sessions rapidly until the configured per-user public-session limit is reached (currently observed at 16 in production). Logs show repeated `mcp_session_created` followed by repeated `mcp_session_capacity_rejected`, with no corresponding `mcp_session_closed` in the observed interval. The existing registry intentionally retains legacy Streamable HTTP sessions across connection/SSE replacement until client DELETE, transport close, idle TTL, or absolute TTL.

## Frozen scope

This change MUST NOT:

- change `MCP_SESSION_IDLE_TTL_SECONDS` or `MCP_SESSION_ABSOLUTE_TTL_SECONDS`;
- change `MCP_SESSION_MAX_PER_USER` or `MCP_SESSION_MAX_TOTAL` defaults or production values;
- reclaim, evict, close, or reuse sessions on capacity pressure;
- change 400/404/429 response behavior;
- change Streamable HTTP session semantics;
- upgrade `@modelcontextprotocol/sdk`;
- migrate to the 2026-07-28 stateless MCP protocol;
- change any MCP tool schema, mutation behavior, database code, Web UI, migrations, or production data.

The output of this PR is evidence only. A later fix PR must be chosen from that evidence.

## Safety requirements

Production lifecycle logs MUST NOT contain full session IDs, user IDs, OAuth subjects, access tokens, authorization headers, cookies, request bodies, tool arguments, database IDs, or secrets.

Client-provided diagnostic labels must be bounded and log-safe before emission. Replace ASCII control characters with spaces, trim, and truncate to 120 characters. Never log arbitrary nested client capabilities.

Use a process-local monotonically increasing `diagnosticSessionOrdinal` to correlate create/close events. It resets on process restart and is not derived from the actual MCP session ID.

## Diagnostic event contract

Extend the existing `McpSessionObserverEvent` contract with safe fields/events only.

### `mcp_initialize_observed`

Emit once for every request that reaches the fresh-initialize path (`!knownSession && isInitializeRequest(body)`), before admission.

Fields:

```ts
{
  name: "mcp_initialize_observed";
  namespace: McpSessionNamespace;
  protocolVersion: string | null;
  clientName: string | null;
  clientVersion: string | null;
  hadUnknownSessionHeader: boolean;
  activeSessionCount: number;
  activeNamespaceCount: number;
}
```

`hadUnknownSessionHeader` is true when the initialize request supplied an `mcp-session-id` header that did not resolve to a registry record. Do not change behavior based on this value.

Read `params.protocolVersion`, `params.clientInfo.name`, and `params.clientInfo.version` defensively from the already-recognized initialize body; sanitize all three labels using the frozen 120-character rule.

### `mcp_session_created`

Add:

```ts
diagnosticSessionOrdinal: number;
```

Do not add the real `sessionId` or `userId`.

### `mcp_session_closed`

Add:

```ts
diagnosticSessionOrdinal: number;
inFlightCountAtClose: number;
idleAgeMsAtClose: number;
```

`idleAgeMsAtClose = max(0, now - lastActivityAt)` at removal time.

### `mcp_session_capacity_rejected`

Change the internal observer call so it receives the authenticated `userId` only for in-process aggregation. The emitted event MUST NOT contain `userId`.

Add:

```ts
activeUserNamespaceCount: number;
idleUserNamespaceCount: number;
inFlightUserNamespaceCount: number;
oldestIdleAgeMs: number | null;
```

Definitions for the authenticated user + current namespace at rejection time:

- idle: `inFlightCount === 0`
- in-flight: `inFlightCount > 0`
- oldest idle age: maximum of `now - lastActivityAt` among idle records, or `null` when there are none.

The invariant must hold:

```ts
idleUserNamespaceCount + inFlightUserNamespaceCount === activeUserNamespaceCount
```

## Files

### Modify `src/mcp/server/session-registry.ts`

1. Add `diagnosticSessionOrdinal` to `McpSessionRecord`.
2. Add a private process-local ordinal counter initialized to zero; increment exactly once for every committed/registered session record.
3. Extend observer event types with the contracts above.
4. Add a public observation method for initialize metadata, e.g.:

```ts
observeInitialize(input: {
  namespace: McpSessionNamespace;
  protocolVersion: string | null;
  clientName: string | null;
  clientVersion: string | null;
  hadUnknownSessionHeader: boolean;
}): void
```

It only emits; it must not mutate capacity or session state.
5. Change `observeCapacityRejected` to accept `(userId, namespace)` and compute the frozen state summary without exposing `userId`.
6. Add the ordinal to created/closed events and the frozen close diagnostics.
7. Do not change `reserve`, `admit`, `acquire`, `finishRequest`, `sweep`, expiry rules, close rules, or capacity decisions except the signature plumbing needed to emit diagnostics.

### Modify `src/mcp/server/router.ts`

1. Add a small local helper that defensively extracts the three initialize labels from `request.body` and sanitizes them. Do not log the body.
2. In the existing fresh initialize branch, call `registry.observeInitialize(...)` immediately before `registry.admit(...)`.
3. Set `hadUnknownSessionHeader` from `Boolean(sessionId)` in that branch. Because `knownSession` is already false there, a supplied header is necessarily unknown to this process.
4. On capacity rejection, call `registry.observeCapacityRejected(userId, namespace)`.
5. Preserve all current HTTP status codes and control flow.

### Modify `src/app/create-app.ts`

Extend the existing safe-field allowlist in `observeMcpLifecycle` with exactly these keys:

- `diagnosticSessionOrdinal`
- `protocolVersion`
- `clientName`
- `clientVersion`
- `hadUnknownSessionHeader`
- `activeUserNamespaceCount`
- `idleUserNamespaceCount`
- `inFlightUserNamespaceCount`
- `oldestIdleAgeMs`
- `inFlightCountAtClose`
- `idleAgeMsAtClose`

Do not log `userId`, `sessionId`, headers, request bodies, tokens, or arbitrary event properties.

## TDD tasks

### Task 1 — Registry diagnostics contract

**Tests:** `tests/mcp-session-registry.test.ts`

Write failing tests first.

Test A: ordinals correlate create and close without identifiers.

- Register two sessions.
- Assert created events have ordinals `[1, 2]`.
- Close the first and assert its close event has ordinal `1`.
- Assert serialized observer events contain neither actual session ID nor user ID values used by the fixture.

Test B: capacity summary distinguishes idle and in-flight records.

- Registry with the same `userId`/`public` namespace: create three sessions.
- Acquire one session and leave it in flight.
- Leave two sessions idle; advance fake `now` so their idle ages differ.
- Call `observeCapacityRejected(userId, "public")`.
- Assert:
  - `activeUserNamespaceCount === 3`
  - `idleUserNamespaceCount === 2`
  - `inFlightUserNamespaceCount === 1`
  - `oldestIdleAgeMs` equals the older idle record's age
  - the count invariant holds.
- Add another user's public session and one internal session; assert neither affects the per-user public summary.

Test C: close diagnostics report safe state.

- Set fake time.
- Register/acquire/finish a session, advance time, close it.
- Assert `inFlightCountAtClose === 0`, `idleAgeMsAtClose` is exact, and the event includes no identifiers.

Run after each failing-test batch:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/mcp-session-registry.test.ts
```

### Task 2 — Real HTTP initialize observations

**Tests:** `tests/mcp-session-preflight.test.ts`

Write failing tests first.

Test A: fresh initialize emits sanitized client metadata.

- Use the real localhost HTTP test harness and a registry observer.
- Initialize with protocol `2025-06-18`.
- Supply client name/version containing control characters and more than 120 characters.
- Assert the event values contain no control characters and are at most 120 characters.
- Assert `hadUnknownSessionHeader === false`.

Test B: unknown session header on initialize is observable but behavior is unchanged.

- Send a valid initialize request with an arbitrary unknown `mcp-session-id` header.
- Assert current initialize response behavior remains whatever the base implementation returns today (do not intentionally change it in this PR).
- Assert `mcp_initialize_observed.hadUnknownSessionHeader === true`.

Test C: real HTTP capacity rejection reports idle/in-flight composition.

- Use a small capacity registry.
- Establish enough sessions to reach capacity.
- Keep one real SSE/HTTP request in-flight if the existing harness can deterministically do so; otherwise build the state through the registry and exercise rejection through HTTP.
- Trigger one extra initialize.
- Assert response remains `429`.
- Assert the capacity event reports exact user+namespace active/idle/in-flight counts.

Keep the existing regression unchanged:

```text
pinned Streamable HTTP sessions survive connection replacement and SSE disconnect until DELETE
```

This diagnostic PR must not "fix" that test.

Focused run:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-session-registry.test.ts \
  tests/mcp-session-preflight.test.ts
```

### Task 3 — Safe production logger allowlist

Add/extend a focused test if there is an existing test surface for `observeMcpLifecycle`; otherwise keep this verification structural and compile-time rather than exporting production-only helpers solely for testing.

Required assertion by code review: only the frozen safe keys above are added to the allowlist. Do not broaden logging to `Object.entries(event)` without a key allowlist.

## Verification gates

Before opening the PR, Codex must report the exact command output for:

```bash
pnpm exec tsx --test --test-concurrency=1 \
  tests/mcp-session-registry.test.ts \
  tests/mcp-session-preflight.test.ts

CI=true pnpm test
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
git diff --check
```

No production database command. No migration. No Railway environment-value changes.

## Diff audit

Expected behavioral-code files are limited to:

```text
src/mcp/server/session-registry.ts
src/mcp/server/router.ts
src/app/create-app.ts
tests/mcp-session-registry.test.ts
tests/mcp-session-preflight.test.ts
```

Plus this plan file. Any other changed file requires explicit explanation before review.

## PR contract

Open a draft PR against fresh `main` with a title equivalent to:

```text
chore: diagnose MCP session capacity exhaustion
```

PR body must explicitly state:

- diagnostic-only; no session admission/lifecycle behavior change;
- base SHA and final head SHA;
- focused test counts;
- canonical suite counts;
- root/Web typecheck + build results;
- `git diff --check` result;
- no production DB/migration/config changes;
- production evidence still required after merge/deploy.

Do not mark ready and do not merge. Return the branch head and draft PR number for review.

## Production evidence after diagnostic deploy

After reviewed merge and successful Railway production deploy, restart once so the process-local registry starts from zero. Reconnect ChatGPT and use MCP normally until enough initialize activity is observed or capacity is reached.

Collect only the new safe lifecycle events. The decision rule for the fix PR is:

### Branch A — accumulated sessions are predominantly idle

Evidence: capacity rejection shows material `idleUserNamespaceCount > 0`, especially if `oldestIdleAgeMs` grows while new initialize events continue.

Then design a separate fix PR for pressure-time reclaim of the oldest idle session belonging to the same authenticated user + namespace, with strict in-flight protection and concurrency tests.

### Branch B — accumulated sessions are predominantly in-flight

Evidence: capacity rejection shows `idleUserNamespaceCount === 0` or very low while `inFlightUserNamespaceCount` accounts for the capacity.

Do NOT add LRU eviction. Trace the real GET/SSE/response-close path through `runRequest -> finishRequest` and determine why requests remain in flight.

### Branch C — mixed

Fix the abnormal in-flight lifecycle first if present. Idle pressure reclaim may still be designed as a separate safety mechanism, but must not hide a request-lifecycle leak.

Only after this evidence is captured should the root-cause fix contract be frozen.

