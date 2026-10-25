# Claude runtime file split implementation plan

> Implementation: execute the user-approved four steps inline; no new runtime architecture.

**Goal:** Separate existing responsibilities in four large Claude runtime files without changing behavior.

**Architecture:** Existing public entry points and state owners remain authoritative. Extract pure projections and parsing first, then delegate SDK execution and idle daemon maintenance through explicit existing dependencies. Four independent branches share the verified main baseline.

**Tech stack:** Node 22, TypeScript, JavaScript ESM, existing node:test suites.

**Spec:** User-approved four-part scope in this task.

## Constraints

- Preserve event shapes, limits, redaction, error codes, retries and deadlines.
- Preserve session/checkpoint state, active-turn fencing and submission ordering.
- No Diary/UI, Hook behavior, dependencies, database schema or scheduling changes.
- No daemon restart, Hook installation or production operations.
- Temporary worktrees only; preserve the canonical checkout.

## Steps

1. Extract normalized event values, metadata and tool result projections; retain stream state and event ordering in `normalized-events.mjs`. Run normalizer, bridge and projection suites.
2. Extract relay HTTP policy and response parsing; retain the client public API and existing retry/deadline policies. Run HTTP client behavior tests and TypeScript checks.
3. Extract SDK wiring/support, persistent startup and foreground execution; retain the transport owner, bound private checkpoint operations and public entry points. Run SDK, persistent session, branch/checkpoint and attachment tests.
4. Extract daemon contracts and idle maintenance; retain running guard, active turn, outbox recovery and reserve/commit ordering in the loop. Run daemon loop/control/recovery tests.

## Review focus

- Tool output privacy, binary bounds and result association stay unchanged.
- Shared deadline/retry handling remains common to every HTTP operation.
- Late callbacks act on the same SDK owner and private checkpoint guards.
- Idle maintenance cannot precede foreground or semantic work.
- Uncertain delivery retains existing fencing and recovery semantics.

## Verification

Each branch gets typecheck/build and targeted tests. Run the production runtime gate for each affected entry point; report environment-blocked tests separately from passes. Compare failures with unchanged main. Existing source-contract checks follow moved declarations without dropping assertions. Record actual results in each PR.
