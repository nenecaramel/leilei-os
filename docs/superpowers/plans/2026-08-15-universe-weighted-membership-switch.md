# Phase 8.3F — Weighted Universe Membership Switch

**Base:** `codex/phase-6-web-ui-foundation` @ `82d3f5968d2b66db4f3ed6fa69f3d95a84c51221`

**Implementation branch:** `codex/phase-8-3-weighted-membership-switch`

## Goal

Switch LeileiOS Universe canonical galaxy membership from legacy `string[]` / PostgreSQL `text[]` to weighted memberships:

```ts
{ id: string; weight: number }[]
```

Use the already-expanded `universe_nodes.galaxy_memberships jsonb` column as the canonical persistence field, preserve weights exactly through revisions/backups/API/Web/export, and close the post-0020 race with a fail-closed `0021` switch gate.

`UNIVERSE_SCHEMA_VERSION` remains `2`.

## Non-goals / hard boundaries

- Do not implement the old-data importer yet.
- Do not touch Global Search or MCP.
- Do not redesign Universe UI.
- Do not add weight inputs, percentages, new color treatment, new controls, or layout changes.
- Do not intentionally alter loading/uninitialized visual states.
- Do not read/write the standalone 思维宇宙 repository. This task is LeileiOS only.
- Do not invent weights for legacy `string[]` data.
- Do not permanently dual-write `galaxies text[]` and `galaxy_memberships jsonb`.
- Do not drop the legacy `galaxies` column in this phase.
- Do not merge or deploy from this task.

## Canonical contract

Add/reuse a type equivalent to:

```ts
export type UniverseGalaxyMembership = {
  id: string;
  weight: number;
};
```

Then change both server and Web `UniverseNode.galaxies` to `UniverseGalaxyMembership[]`.

`UniverseRevisionSnapshot.galaxies` must become weighted automatically/explicitly and preserve the same shape.

Validation rules:

- `galaxies` must be an array.
- Every item must be an object.
- `id` must be a nonblank string using the existing Universe ID length convention.
- `weight` must be a finite number.
- Do **not** impose `[0,1]`, clamp, normalize, or otherwise reinterpret weight.
- Duplicate membership IDs are invalid.
- Membership IDs must refer to existing galaxies.
- Legacy `string[]` must be rejected rather than normalized or assigned default weights.

## Task 1 — Server contract + validation, test first

Primary files:

- `src/domains/universe/universe-types.ts`
- `src/domains/universe/universe-validation.ts`
- `tests/universe-validation.test.ts`

Write failing tests before implementation for:

1. weighted memberships accepted and round-tripped;
2. finite weights outside `[0,1]` are not silently clamped/rejected solely for range;
3. legacy `string[]` rejected;
4. non-finite weights rejected in direct validator tests;
5. duplicate membership IDs rejected;
6. unknown galaxy references rejected by `membership.id`;
7. revision snapshots preserve/validate weighted memberships.

Then implement only enough to make those tests pass.

Commit suggestion: `feat: define weighted Universe galaxy memberships`

## Task 2 — Repository/service/API persistence switch, test first

Primary files:

- `src/domains/universe/universe-repository-drizzle.ts`
- related Universe service/router/API files discovered from current source
- `tests/universe-repository.integration.test.ts`
- `tests/universe-service.test.ts`
- `tests/universe-api.test.ts`

Required behavior:

- `toNodeInsert` writes `galaxyMemberships: node.galaxies`.
- New canonical writes do not populate legacy `galaxies`; let it remain empty.
- `fromNodeRow` reads weighted data from `row.galaxyMemberships`, never from `row.galaxies` for canonical output.
- Galaxy reference checks use membership IDs, e.g. `node.galaxies.map((membership) => membership.id)`.
- Revisions store weighted snapshots unchanged.
- Backups create/restore weighted memberships unchanged.
- API/service create/update/save/read flows preserve exact weights.
- Legacy string membership payloads fail validation.
- Version conflict / revision semantics remain unchanged.

Integration assertions must prove:

- weighted node insert/update/read round-trip exact weights;
- legacy `universe_nodes.galaxies` remains empty after new writes;
- revision snapshots preserve exact weights;
- backup create/restore preserves exact weights.

Commit suggestion: `feat: persist weighted Universe memberships`

## Task 3 — Web contract/adapter/export propagation, test first

Primary files:

- `web/src/pages/universe/universe-types.ts`
- `web/src/pages/universe/universe-adapter.ts`
- `web/src/pages/universe/universe-service.ts` only if needed
- `web/src/pages/universe/universe-export.ts`
- `tests/universe-web-adapter.test.ts`
- `tests/universe-web-export.test.ts`

Requirements:

- Mirror weighted membership type on Web side.
- Adapter requests/responses preserve the full `{id, weight}` object array.
- Export preserves exact weights.
- No legacy `string[]` normalization.

Commit suggestion: `feat: propagate weighted Universe memberships to web`

## Task 4 — Minimal Universe Web membership semantics, test first

Primary files:

- `web/src/pages/UniversePage.tsx`
- `tests/universe-web-page.test.ts`

Keep current checkbox UI. Change data semantics only.

Filtering:

```ts
node.galaxies.some((membership) => membership.id === galaxyFilter)
```

Editing rules:

- Existing selected memberships retain their exact existing weights.
- Deselecting removes that membership and does not renormalize the others.
- Existing membership order is preserved.
- Newly selected memberships append deterministically.
- If a node has zero memberships, the first newly selected galaxy gets `weight: 1`.
- Additional newly selected galaxies get `weight: 0.72`.
- A node imported later with arbitrary weights must round-trip unchanged unless the user explicitly removes/adds memberships.

Do not add any weight-specific UI.

Tests must cover weight preservation, first-add `1`, subsequent-add `0.72`, deselection without renormalization, and membership-id filtering.

Commit suggestion: `feat: preserve weighted memberships in Universe editor`

## Task 5 — Migration 0021 switch gate, real PostgreSQL test

Primary files:

- `drizzle/0021_universe_weighted_membership_switch.sql`
- `drizzle/meta/_journal.json`
- matching Drizzle snapshot if repository convention requires it
- new migration integration test, preferably `tests/universe-weighted-switch-migration.integration.test.ts`

Use a single transactional operation/block following 0020 safety conventions.

Before the switch constraint, lock membership-bearing tables so old writes cannot interleave with census + DDL. Reuse the 0020 lock strength unless current migration conventions require an equivalent stronger safe lock:

```sql
LOCK TABLE "universe_nodes", "universe_revisions", "universe_backups"
IN SHARE ROW EXCLUSIVE MODE;
```

Fail closed with a generic error such as:

```text
UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT
```

Do not include user IDs, node IDs, payloads, titles, content, or other private data in migration errors.

Abort if any of the following is unsafe:

A. any `universe_nodes.galaxies` is non-empty;

B. any `universe_revisions.snapshot.galaxies` is malformed, non-array, or non-empty;

C. any `universe_backups.data.nodes[*].galaxies` is malformed, non-array, or non-empty;

D. any `universe_backups.data.revisions[*].snapshot.galaxies` is malformed, non-array, or non-empty.

Also fail closed when expected top-level backup `nodes` / `revisions` structures are present in an unsafe/wrong type according to the same 0020 census policy. Prefer reusing/refactoring no application code if the SQL can remain explicit and auditable.

Only after all checks pass, add a constraint equivalent to:

```sql
CHECK (cardinality(galaxies) = 0)
```

with an explicit durable name such as `universe_nodes_legacy_galaxies_empty`.

Do not drop the old column.

Real disposable PostgreSQL 16 integration tests must prove:

1. safe empty legacy state succeeds;
2. each unsafe node/revision/backup-node/backup-revision branch aborts and rolls back;
3. the legacy-empty constraint exists after success;
4. after success, inserting/updating a non-empty legacy `galaxies` array fails;
5. weighted `galaxy_memberships` JSONB writes still succeed;
6. no production database is contacted.

This constraint intentionally makes stale old-app writes fail closed during the short mixed-version deployment window rather than silently diverge.

Commit suggestion: `feat: gate weighted Universe membership switch`

## Task 6 — Full regression / PR preparation

Run targeted Universe tests first, then the deterministic repository gate:

```bash
pnpm exec tsx --test --test-concurrency=1 tests/**/*.test.ts
pnpm typecheck
pnpm build
(
  cd web
  pnpm typecheck
  pnpm build
)
git diff --check
git status --short
```

For PostgreSQL integration tests use only a disposable local PostgreSQL 16 instance/container. Do not use production credentials or mutate production.

Review the final diff for these invariants:

- no unrelated files/refactors;
- no importer;
- no Global Search/MCP;
- no UI redesign;
- no dual write;
- old `text[]` column retained but forced empty by 0021;
- canonical JSONB memberships retain exact weights;
- schema version remains 2.

Push the implementation branch and open a **Draft** PR targeting `codex/phase-6-web-ui-foundation` titled:

`Phase 8.3: switch Universe to weighted galaxy memberships`

PR body must include:

- exact base SHA;
- summary of canonical contract switch;
- 0021 fail-closed race gate;
- targeted + full test results;
- disposable PostgreSQL 16 migration-test result;
- explicit statement that production was not mutated;
- explicit statement that importer / Global Search / MCP / UI redesign are out of scope.

Do not mark ready, merge, or deploy. Stop after the Draft PR is pushed so ChatGPT can inspect the actual branch/commit/diff and decide the next gate.
