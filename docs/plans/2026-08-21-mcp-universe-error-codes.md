# MCP Universe Write Error Codes — Acceptance Hotfix Plan

Date: 2026-08-21
Status: Frozen for implementation
Issue: #205
Branch: `fix/mcp-universe-error-codes`
Base: `main@b77fe4ee3fe9017787ae134ffb1d13e61c6c417b`

## Why this hotfix exists

Phase 8.5 production acceptance proved the actual write semantics are correct: node create/replay, node partial update, stale-version CAS rejection, relation create/replay, self-link rejection, duplicate-relation rejection, state/version preservation on failed mutations, and no blind retry all passed in production.

The remaining acceptance failure is observability: the three Universe write tools currently convert `UniverseServiceError.code` into safe natural-language text and discard the stable business code from the MCP result. The frozen Phase 8.5 design requires established error classes such as `VERSION_CONFLICT`, `RELATION_INVALID`, and `RELATION_CONFLICT` to be preserved and surfaced.

This is an MCP response-contract hotfix only. It must not change Universe mutation semantics.

## Frozen scope

Only these three write tools are in scope:

- `create_universe_node`
- `update_universe_node`
- `create_universe_relation`

Expected production files are limited to the smallest necessary subset of:

- `src/mcp/tools/universe/shared.ts`
- the three Universe write `register.ts` files
- focused Universe MCP write tests

Do not change:

- Universe domain/repository behavior
- database schema or migrations
- CAS/version behavior
- idempotency semantics
- active-user transaction behavior
- relation invariants
- Universe read-tool error contract
- Web/UI
- MCP transport/session lifecycle or SDK version
- production data except controlled post-deploy negative-path acceptance requests

## Required external error contract

For known `UniverseServiceError` failures emitted by the three write tools:

- preserve `isError: true`;
- preserve the current safe human-readable message;
- add `structuredContent` with a stable machine-readable business code;
- also include the exact code in the text content so clients that render only `content` still expose the code to ChatGPT;
- never expose raw database/driver/internal error details.

The structured error shape is frozen as:

```ts
{
  success: false,
  error: {
    code: <stable Universe write business error code>,
    message: <same safe public message>,
  },
}
```

Text content should be deterministic and code-bearing, for example:

```text
VERSION_CONFLICT: Universe changed since expected_version; fresh-read before deciding whether to retry.
```

At minimum the following production-observed codes must be represented exactly:

- `VERSION_CONFLICT`
- `RELATION_INVALID`
- `RELATION_CONFLICT`

The write-specific schema may safely include other already-established `UniverseServiceErrorCode` values that can actually arise from these three write methods, but must not invent a second competing taxonomy. Unknown/non-domain failures remain generic/fail-closed.

`UniverseAuthenticationError` and unknown internal exceptions must retain their existing non-sensitive behavior. Do not broaden this hotfix into a global MCP error-envelope redesign.

## Output schema contract

Each of the three write tools currently declares a success-only `outputSchema`. Because known business failures will now return structured content, update only these three write-tool output schemas to describe both:

- existing success result (`success: true`, existing `data` unchanged), and
- structured business error result (`success: false`, `error.code`, `error.message`).

Prefer a shared write-error Zod schema/helper so the three tools cannot drift, while keeping each tool's existing success data schema unchanged.

Do not update Universe read-tool output schemas in this hotfix.

## TDD sequence

### RED 1 — stale CAS code

In `tests/mcp-universe-write-tools.test.ts`, extend the client-level test that injects `UniverseServiceError("VERSION_CONFLICT")`.

Assert all of:

- `result.isError === true`
- `result.structuredContent.success === false`
- `result.structuredContent.error.code === "VERSION_CONFLICT"`
- safe message remains present
- text content includes `VERSION_CONFLICT`

Run the focused test and record the expected RED: current implementation has no structured business code.

### RED 2 — relation codes

Add focused client-level assertions for:

- MCP self-link boundary -> `RELATION_INVALID`
- service duplicate directional relation -> `RELATION_CONFLICT`

Both must fail before production implementation because current `safeUniverseError()` returns text-only errors.

### GREEN — minimal write-specific error envelope

Implement the smallest write-specific mapping/helper.

Recommended direction:

1. Keep the existing safe-message mapping authoritative.
2. Add a write-specific error-result helper that, for known `UniverseServiceError`, returns:
   - `isError: true`
   - code-bearing safe text
   - structured `{ success:false, error:{code,message} }`
3. Wire only the three Universe write tools to the write-specific helper.
4. Expand only those three output schemas to a success/error discriminated union (or equivalent strict schema).
5. Leave existing Universe read tools using the existing read error result unchanged.

Do not change the thrown domain codes or catch errors lower in the repository.

## Regression tests

Focused tests must also confirm:

- successful create/update/relation structured outputs are byte-for-byte shape-compatible with the pre-hotfix success contract;
- idempotent replay success metadata remains unchanged;
- unknown/internal errors remain generic and do not expose stack/driver details;
- read-tool error behavior/output schema is unchanged;
- no mutation is retried by the error mapper.

## Verification gates

Before Draft PR:

1. focused Universe MCP write tests — PASS
2. deterministic canonical suite — 0 failed
3. root typecheck — PASS
4. root build — PASS
5. Web typecheck — PASS
6. Web build — PASS
7. `db:check` — PASS (no new migration expected)
8. `git diff --check` — PASS
9. worktree clean
10. production DB touched — NO

If repository path filters trigger hosted PostgreSQL/active-user verification, let it run and require it green on the exact PR HEAD; do not weaken or bypass it. This hotfix itself must not add a new database workflow because it changes no database behavior.

Finish with a Draft PR. Do not merge and do not deploy.

## Production re-acceptance after review/merge/deploy

Reuse the retained Phase 8.5 resources:

- Node A: `node-c6945d26-fb23-414f-82e4-b5505c02c333`
- Node B: `node-f37f37e2-985a-45ee-af69-70f83d6d5a78`
- Relation A→B: `edge-e925faa3-24e1-4088-bca9-10dd6d2be0f6`
- last accepted Universe version: `46`

No new node/relation creation is necessary for re-acceptance except intentionally failing requests.

After exact merge SHA deployment:

1. fresh-read current Universe and record current version;
2. stale update Node A using a deliberately older expected version and a patch value that must not commit;
   - response must expose structured `error.code = VERSION_CONFLICT`;
   - fresh readback proves node/state/version unchanged;
3. self relation Node A→Node A with fresh current version and a new idempotency key;
   - response must expose structured `error.code = RELATION_INVALID`;
   - fresh readback proves no relation/version change;
4. duplicate directional A→B relation with a new idempotency key and fresh current version;
   - response must expose structured `error.code = RELATION_CONFLICT`;
   - original relation remains unchanged;
   - no duplicate relation;
   - version unchanged.

If all three pass, Phase 8.5 production acceptance is complete. Close Issue #205 and then Issue #203, update the mainline, and only then enter the next project phase.