# MCP Idle Session Capacity Reclaim Implementation Plan

> Root-cause fix selected from production diagnostics. This is no longer a diagnostic-only change.

**Base:** `29a1f66c92945b7593b494d30d1afc5440ba45db` (`main`, PR #197 merge)

**Branch:** `fix/mcp-session-idle-capacity-reclaim`

## Production evidence / root cause

The diagnostic deployment reproduced the failure with the real ChatGPT MCP client:

- `protocolVersion = 2025-11-25`
- `clientName = openai-mcp`
- `clientVersion = 1.0.0`
- repeated fresh initialize requests with `hadUnknownSessionHeader = false`
- public session count grew to the configured production per-user limit `16`
- at rejection: `activeUserNamespaceCount = 16`
- at rejection: `idleUserNamespaceCount = 16`
- at rejection: `inFlightUserNamespaceCount = 0`
- `oldestIdleAgeMs` was already above 200 seconds and continued increasing

This proves Branch A from the diagnostic plan: the outage is not an in-flight/SSE request leak. ChatGPT creates replacement/fresh legacy Streamable HTTP sessions faster than the server's two-hour idle TTL removes abandoned idle sessions. The hard per-user limit is therefore exhausted by idle sessions.

The fix must preserve a hard bound while allowing a new initialize to replace an older idle session. Raising `MCP_SESSION_MAX_PER_USER` again is explicitly not a fix.

## Frozen behavior

### Capacity-pressure reclaim

`McpSessionRegistry.admit(userId, namespace)` keeps its existing order first:

1. normal lazy expiry sweep;
2. reserve attempt;
3. forced expiry sweep;
4. reserve attempt.

Only if those existing attempts still fail, perform **one** capacity-pressure reclaim attempt:

1. Find the oldest session belonging to the same authenticated `userId` and the same namespace with `inFlightCount === 0`.
2. Oldest ordering is deterministic: smallest `lastActivityAt`, then smallest `createdAt`, then smallest `diagnosticSessionOrdinal`.
3. Never select `inFlightCount > 0`.
4. Never select another user or another namespace.
5. Remove the selected record synchronously from capacity accounting with close reason `capacity_reclaim`.
6. Immediately reserve the freed slot for the requesting user/namespace before awaiting provider/server cleanup, so concurrent initialize requests cannot steal the slot between reclaim and reservation.
7. Await the reclaimed record's provider/server cleanup after the replacement reservation has been secured. Cleanup failure remains non-fatal, matching existing close behavior.
8. If there is no eligible same-user/same-namespace idle session, return `null` and preserve the existing `429 MCP session capacity exceeded` behavior.
9. If reservation still cannot be secured after the single reclaim, return `null`; do not cascade through multiple unrelated sessions.

This means normal reconnect churn replaces the oldest idle session at the boundary while the registry remains bounded. It is not an LRU cache for active sessions.

### Close reason / observability

Extend `McpSessionCloseReason` with:

```ts
"capacity_reclaim"
```

No new identifiers are logged. Existing `mcp_session_closed` diagnostics already expose safe ordinal, namespace, duration, in-flight count at close, and idle age. A successful pressure reclaim should therefore be visible as:

```text
mcp_session_closed reason=capacity_reclaim inFlightCountAtClose=0
```

`mcp_session_capacity_rejected` should only be emitted when reclaim cannot obtain a replacement reservation and the initialize will actually return 429.

### Stale/reclaimed session HTTP semantics

A client that later presents a session ID that no longer exists needs an unambiguous session-not-found response so it can initialize again.

Change only the unknown/stale-session cases:

- POST non-initialize + supplied unknown `mcp-session-id` -> HTTP 404.
- GET + supplied unknown `mcp-session-id` -> HTTP 404.
- DELETE + supplied unknown `mcp-session-id` -> HTTP 404.
- A session that was known before `acquire` but is removed by expiry during `acquire` -> HTTP 404.

Preserve:

- missing session header on a non-initialize request -> current 400;
- cross-namespace session ID -> current 400;
- session belonging to another authenticated user -> current 403;
- fresh initialize with no session ID -> current behavior;
- fresh initialize carrying an unknown session ID -> current initialize behavior (diagnosed but not rejected solely for that header);
- capacity failure after no reclaim candidate -> current 429.

Do not expose whether a random unknown ID ever belonged to another user or namespace.

## Explicit non-goals

Do not:

- change idle TTL (`7200s`) or absolute TTL (`86400s`);
- change repository defaults (`8` per user+namespace, `32` process total);
- raise production capacity again;
- reclaim in-flight sessions;
- reclaim another user or namespace's idle sessions;
- change OAuth/auth ownership behavior;
- change MCP tools, mutation contracts, database code, migrations, Web UI, or production data;
- upgrade `@modelcontextprotocol/sdk`;
- migrate this PR to MCP `2026-07-28` stateless transport;
- add broad background timers or periodic eviction.

A future stateless-protocol migration remains a separate architecture task.

## TDD implementation

### Task 1 — Registry pressure reclaim contract

**Modify:** `src/mcp/server/session-registry.ts`

**Tests:** `tests/mcp-session-registry.test.ts`

Write failing tests first for all cases below.

1. **Oldest same-user idle session is reclaimed and admission succeeds.**
   - Fill `maxPerUser` with idle `public` sessions for one user.
   - Give them distinct `lastActivityAt` values.
   - Call `admit` once more.
   - Assert a reservation is returned.
   - Assert the oldest idle session is gone and newer sessions remain.
   - Assert capacity never exceeds the configured max.
   - Assert one close event with `reason === "capacity_reclaim"` and `inFlightCountAtClose === 0`.

2. **In-flight sessions are never reclaimed.**
   - At capacity, leave every same-user session in flight.
   - `admit` returns `null`.
   - No session is closed with `capacity_reclaim`.

3. **Idle candidate selection excludes other users and namespaces.**
   - Include older idle sessions for another user and for `internal`.
   - Ensure only the requester's same-user `public` idle session can be selected.

4. **Total-capacity pressure may reclaim the requester's own idle session.**
   - Configure `maxTotal` lower than `maxPerUser`.
   - Fill total capacity while the requester owns at least one idle session.
   - Assert reclaim of that own idle session permits the replacement reservation without touching other users/namespaces.

5. **No own idle candidate preserves rejection.**
   - If process total is full due to other users/namespaces and requester has no eligible idle session, `admit` returns `null` and does not evict someone else.

6. **Concurrent replacement admission is bounded and deterministic.**
   - Fill `maxPerUser` with idle sessions.
   - Start two concurrent `admit` calls.
   - Both should obtain reservations when two idle victims are available.
   - Exactly two oldest eligible idle sessions are reclaimed.
   - `capacitySize` never exceeds max.
   - No in-flight session is reclaimed.

7. **Provider cleanup failure does not lose the secured reservation or resurrect a session.**
   - Reclaimed server `.close()` throws.
   - Replacement admission still succeeds.
   - Victim remains absent.

Keep all existing TTL, hard deadline, reservation, namespace, and close-race tests passing unchanged.

### Task 2 — Real HTTP reconnect churn regression

**Modify tests:** `tests/mcp-session-preflight.test.ts`

Use the existing real localhost TCP/HTTP harness.

1. Set a small `maxPerUser` such as 3.
2. Send at least 8 sequential fresh initialize requests from the same user and `public` namespace.
3. Do not send DELETE for old sessions.
4. Assert every initialize returns 200; no request returns 429.
5. Assert registry committed-session count remains at or below 3 after each initialize.
6. Assert the oldest idle sessions are closed with `capacity_reclaim` and every such close has `inFlightCountAtClose === 0`.
7. Preserve the existing regression that a session survives ordinary SSE/connection replacement when there is no capacity pressure.

This is the primary regression for the production incident.

### Task 3 — Reclaimed/stale session 404 contract

**Modify:** `src/mcp/server/router.ts`

**Tests:** `tests/mcp-session-preflight.test.ts`

Add focused HTTP tests:

1. After a session has been reclaimed, a non-initialize POST using its old ID returns 404.
2. GET using a reclaimed/unknown supplied session ID returns 404.
3. DELETE using a reclaimed/unknown supplied session ID returns 404.
4. Missing session header still returns 400 where it does today.
5. Cross-namespace ID remains 400.
6. Wrong-user access to an existing session remains 403.
7. Fresh initialize with an arbitrary unknown session header retains the pre-fix behavior already covered by diagnostics tests.
8. A fresh initialize after receiving stale-session 404 succeeds and creates a replacement session.

Do not change unrelated error JSON or MCP tool behavior.

### Task 4 — Exact-head CI gate for MCP lifecycle changes

**Add:** `.github/workflows/mcp-session-lifecycle-verify.yml`

Trigger on pull requests to `main` when any of these change:

```text
src/mcp/server/session-registry.ts
src/mcp/server/router.ts
tests/mcp-session-registry.test.ts
tests/mcp-session-preflight.test.ts
.github/workflows/mcp-session-lifecycle-verify.yml
```

Job requirements:

- Node 24
- pnpm 11.9.0
- `pnpm install --frozen-lockfile`
- `cd web && npm ci`
- focused registry/preflight tests
- deterministic canonical `pnpm test`
- root `pnpm typecheck`
- root `pnpm build`
- `cd web && npm run typecheck && npm run build`
- `git diff --check`

No PostgreSQL service and no production secrets are required.

## Verification gates

Before review, report exact outputs for:

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

If the local pnpm wrapper still hangs silently, diagnose that separately enough to prove it is tooling/environmental; do not silently omit the equivalent locked commands. GitHub Actions on the exact PR head is the canonical hosted evidence for this fix.

No production database command, migration, or Railway mutation during implementation/testing.

## Expected diff scope

Expected files:

```text
src/mcp/server/session-registry.ts
src/mcp/server/router.ts
tests/mcp-session-registry.test.ts
tests/mcp-session-preflight.test.ts
.github/workflows/mcp-session-lifecycle-verify.yml
docs/plans/2026-08-21-mcp-session-idle-capacity-reclaim.md
```

Any additional file requires explicit explanation before review.

## PR contract

Open a **Draft PR** against fresh `main`, title equivalent to:

```text
fix: reclaim idle MCP sessions under capacity pressure
```

PR body must include:

- base SHA and final head SHA;
- production evidence selecting Branch A;
- exact reclaim semantics;
- exact 404 scope;
- focused and canonical test counts;
- root/Web typecheck + build;
- GitHub Actions exact-head result;
- `git diff --check`;
- production DB touched: NO;
- no TTL/capacity-default/SDK/tool/database behavior change.

Do not mark ready and do not merge. Return the draft PR for review.

## Production acceptance after merge

1. Verify Railway Production deploys the exact merge SHA successfully.
2. Restore Railway `MCP_SESSION_MAX_PER_USER` from the temporary rescue value `16` back to canonical default `8`, then restart so the process-local registry begins at zero.
3. Reconnect ChatGPT in a fresh conversation and continue normal MCP work; do not manufacture synthetic production traffic beyond the pending acceptance flow.
4. Observe that fresh initialize churn can pass 8 total initializations without permanent 429.
5. At pressure, expect `mcp_session_closed` with `reason=capacity_reclaim`, `inFlightCountAtClose=0`, and active session count staying bounded.
6. No normal reconnect should produce a stable `mcp_session_capacity_rejected` loop.
7. Resume PR A production acceptance:
   - first fresh-read Task `b784cb25-0459-4c28-aa7f-2532904c11e8` because the prior `start` mutation returned transport-level 429 and its outcome is uncertain;
   - if still `pending`, execute `start -> in_progress -> cancel -> cancelled -> reopen -> in_progress`, fresh-read after every mutation;
   - if already `in_progress`, continue from `cancel -> cancelled -> reopen -> in_progress` without repeating `start`;
   - create a second temporary Task and verify `pending -> cancel -> cancelled -> reopen -> pending`, fresh-read after every mutation.
8. PR A may be marked production accepted only when both transition paths are proven and the exact production deployment SHA is recorded.
9. Keep the existing acceptance resources until the phase is formally closed.
