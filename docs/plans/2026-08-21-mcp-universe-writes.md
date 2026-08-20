# MCP Universe Writes — Implementation Plan

Date: 2026-08-21
Status: Ready for implementation
Branch: `feature/mcp-universe-writes`
Base: `main@70a5882c71eac1dfb47dd241079efd524c721cf4`
Design: `docs/plans/2026-08-21-mcp-universe-writes-design.md`

## Objective

Implement the frozen first MCP Universe write surface with exactly three tools:

- `create_universe_node`
- `update_universe_node`
- `create_universe_relation`

Follow TDD. Do not merge or deploy. Do not touch production DB. Keep all changes inside the frozen design.

## Hard constraints

- Preserve existing Universe active-user, ownership, transaction, CAS, revision, galaxy-reference, and duplicate-relation semantics.
- Every Universe MCP mutation requires explicit caller-supplied `expected_version`.
- Create node/relation use the existing durable MCP idempotency ledger atomically with the Universe mutation.
- `update_universe_node` is a partial patch and does not use the durable create ledger.
- MCP forbids relation self-links without changing repository-wide historical self-link behavior.
- MCP node positions are strict `0..100`; relation strength is strict `0..1`; no silent clamp.
- No delete/restore/backup/full-save/importance/migration writes/Web UI changes/session or SDK changes.

## Task 1 — Add RED contract tests for the three MCP tools

Before implementation, add focused tests that fail against current code because the three write tools do not exist and their contracts are not wired.

Cover at minimum:

### Registration and annotations

Assert exact registration names and annotations:

Create tools:

```ts
{
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

Update tool:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}
```

### `create_universe_node` schema

- requires `title`, `summary`, `content`, `type`, `tags`, `galaxies`, `position`, `expected_version`, `idempotency_key`;
- rejects caller-supplied IDs/timestamps/importance/migration and other unknown keys;
- rejects invalid/non-finite/out-of-range position values;
- accepts boundary positions 0 and 100;
- preserves current domain validation for tags, galaxy memberships, strings, and expected version.

### `update_universe_node` schema

- requires stable node ID and `expected_version`;
- permits only `title`, `summary`, `content`, `type`, `tags`, `galaxies`, `position` as patch fields;
- rejects empty patch;
- rejects IDs/timestamps/importance/migration/reason/unknown fields;
- accepts `tags: []`, `galaxies: []`, and domain-legal empty strings;
- rejects invalid/out-of-range position.

### `create_universe_relation` schema

- requires `source`, `target`, `relation_type`, `strength`, `expected_version`, `idempotency_key`;
- relation type is exactly the six frozen values;
- rejects caller ID/timestamp/unknown fields;
- rejects non-finite strength and strength outside `0..1`;
- accepts 0 and 1.

Run the focused test(s) and record the expected RED before implementing production code.

## Task 2 — Generalize the durable idempotency ledger resource ID

### Schema/domain changes

Update the existing MCP write idempotency types and DB schema so the same ledger supports Universe prefixed IDs.

Frozen additions:

Tool types:

- `create_universe_node`
- `create_universe_relation`

Resource types:

- `universe_node`
- `universe_relation`

Change ledger `resource_id` from PostgreSQL UUID to text/string in the Drizzle schema and TypeScript domain/repository types.

Do not loosen unrelated columns or existing constraints.

### Migration

Generate the repository's next normal Drizzle migration after journal entry `0024_brainy_wildside` rather than hand-inventing a migration sequence/tag.

The SQL must perform a lossless conversion equivalent to:

```sql
ALTER TABLE ... ALTER COLUMN resource_id TYPE text USING resource_id::text;
```

and replace/update the tool/resource type check constraints consistently with the schema.

### RED/GREEN migration coverage

Add/extend migration/schema tests so they prove:

- an existing UUID ledger row survives migration and reads back as the identical textual UUID;
- new prefixed resource IDs such as `node-...` and `edge-...` are accepted;
- unsupported tool/resource types are still rejected;
- existing Memory/Diary/Task ledger rows and behavior remain valid.

Verify migration against ephemeral/local PostgreSQL only. Never point migration commands at production.

## Task 3 — Extend the shared idempotency domain without regressing existing creates

Update `src/domains/mcp-write/mcp-write-idempotency.ts` and its repository implementation/types as needed for string resource IDs and the two new tool/resource types.

Preserve:

- advisory transaction lock key semantics;
- request fingerprint comparison;
- same-key/same-fingerprint replay;
- same-key/different-fingerprint `IDEMPOTENCY_KEY_REUSED` behavior;
- existing Memory/Diary/Task behavior.

Add focused tests for new text IDs plus regressions for the existing three create tools.

## Task 4 — Add atomic Universe MCP create operations

Do not implement create idempotency in `register.ts` by calling a normal Universe create and then separately writing the ledger.

Extend Universe service/repository with MCP-specific atomic create paths analogous to the existing Memory MCP-create pattern. Suggested naming may follow repository conventions, but behavior is normative.

### Node create transaction

Within one DB transaction:

1. acquire the existing ledger advisory transaction lock for `(user, create_universe_node, idempotency_key)`;
2. check ledger before CAS;
3. ledger hit:
   - compare fingerprint;
   - on mismatch throw existing key-reuse error;
   - on match load the stored node from authoritative current Universe state;
   - if stored node is absent, fail closed; never recreate;
   - return replay result with current authoritative Universe version and no version bump;
4. ledger miss:
   - retain transaction-scoped durable active-user guard;
   - assert caller `expected_version`;
   - run existing node create normalization/invariants and galaxy reference checks;
   - insert node;
   - bump Universe version once;
   - insert ledger row containing the generated `node-...` text resource ID;
   - return authoritative result.

### Relation create transaction

Same ordering, using `(user, create_universe_relation, idempotency_key)` and storing the generated `edge-...` resource ID.

Before repository create, the MCP-facing service/adapter must reject `source === target` as `RELATION_INVALID`. Do not alter the repository's pre-existing ability to store a self relation for other callers.

On ledger miss, preserve existing relation node-existence and directional duplicate conflict behavior.

### Fingerprints

Build deterministic request fingerprints from stable caller-controlled create fields including `expected_version`; never include generated resource IDs/timestamps.

Tests must prove:

- exact replay creates once and does not bump version again;
- replay still succeeds after the current Universe version has advanced because ledger lookup precedes CAS;
- same key with changed payload conflicts;
- same key with only changed expected version conflicts;
- stale expected version on a new key gives `VERSION_CONFLICT` and writes neither resource nor ledger;
- concurrent same-key creates result in exactly one resource and one durable ledger record;
- a transaction failure cannot leave only one side of resource/ledger state;
- ledger hit with a missing stored resource fails closed and does not recreate;
- disabled/inactive user cannot win a race through the mutation transaction.

## Task 5 — Implement strict MCP-boundary validation helpers

Prefer small shared Universe MCP helpers under the existing Universe MCP tool area rather than duplicating validation in three registers.

Boundary-only rules:

- position x/y finite and `0 <= value <= 100`;
- relation strength finite and `0 <= strength <= 1`;
- self relation rejected;
- strict exposed field sets;
- explicit non-negative integer `expected_version`;
- create-only stable non-empty idempotency key using existing MCP input bounds/conventions.

Do not silently normalize invalid coordinates or strength into range.

Do not invent a new galaxy membership weight range; retain current domain semantics unless an existing canonical invariant elsewhere already requires one.

## Task 6 — Implement `create_universe_node`

Add the tool directory following repository conventions, expected files such as:

- `src/mcp/tools/create-universe-node/schema.ts`
- `src/mcp/tools/create-universe-node/register.ts`

Use the frozen strict schema.

Handler flow:

1. receive authenticated user context through existing MCP server wiring;
2. boundary-validate the frozen request;
3. call the atomic Universe MCP-node create path;
4. select authoritative created/replayed node from the returned state;
5. return compact structured content with:
   - node;
   - `universe_version`;
   - create/replay metadata consistent with current MCP create tools (`created` / `idempotent_replay` or repository-equivalent established names).

Do not return the full snapshot and do not construct success from request echo.

## Task 7 — Implement `update_universe_node`

Add the tool directory following conventions, expected files such as:

- `src/mcp/tools/update-universe-node/schema.ts`
- `src/mcp/tools/update-universe-node/register.ts`

Use a real partial patch. Do not fresh-read and synthesize a caller-side full replacement object in the register layer.

The service can reuse its existing node merge/validation behavior, but the MCP handler must pass only the frozen allowed patch and fixed revision reason `mcp_update`.

Handler flow:

1. strict schema/boundary validation;
2. call existing safe Universe update path with caller `expected_version` and fixed reason;
3. select authoritative updated node from returned state;
4. return node + new `universe_version` only.

Tests must prove:

- a one-field patch preserves all omitted fields;
- `tags: []` clears tags;
- `galaxies: []` clears galaxies;
- domain-legal empty strings clear/empty their fields;
- no writable hidden fields;
- update creates exactly the normal Universe revision with reason `mcp_update`;
- stale version changes nothing and creates no revision;
- successful update bumps version once.

## Task 8 — Implement `create_universe_relation`

Add the tool directory following conventions, expected files such as:

- `src/mcp/tools/create-universe-relation/schema.ts`
- `src/mcp/tools/create-universe-relation/register.ts`

Handler flow:

1. strict request validation including six relation types and `0..1` strength;
2. reject self relation at MCP boundary;
3. call atomic idempotent relation-create path;
4. return authoritative relation + `universe_version` + create/replay metadata.

Tests must prove:

- missing source/target becomes established relation-invalid/not-found behavior from the existing domain path;
- self relation rejected before mutation;
- exact replay no duplicate/no extra version bump;
- duplicate directional `(source,target,type)` with a new idempotency key returns `RELATION_CONFLICT`;
- no automatic update/upsert of existing relation strength/type.

## Task 9 — Wire all three tools into the MCP server

Update `src/mcp/server/create-server.ts` and only the required dependency wiring.

Reuse the existing `UniverseService` and shared durable idempotency repository/service infrastructure. Avoid duplicate DB/service construction where existing wiring can be passed through safely.

Add registration/source-contract tests so omission from server wiring cannot regress silently.

## Task 10 — Preserve error taxonomy and uncertain-outcome behavior

Map Universe/domain errors through the existing MCP Universe error conventions rather than creating a parallel taxonomy.

Required observable classes include as applicable:

- `VERSION_CONFLICT`
- `NODE_NOT_FOUND`
- `RELATION_INVALID`
- `RELATION_CONFLICT`
- `INVALID_UNIVERSE`
- active-user authorization/unavailable errors
- existing `IDEMPOTENCY_KEY_REUSED` create-idempotency error

Do not internally auto-retry `VERSION_CONFLICT`.

Tool descriptions/error metadata should make it possible for ChatGPT to follow the recovery rule: fresh-read authoritative state after uncertain mutation outcome; no blind mutation retry.

## Task 11 — PostgreSQL integration and concurrency verification

Add/extend real PostgreSQL integration tests for the atomic create paths. The hosted CI gate must not rely only on mocks for ledger/transaction/CAS behavior.

Required integration cases:

- migration from UUID ledger resource ID to text;
- atomic node create + ledger insert;
- atomic relation create + ledger insert;
- exact replay;
- changed fingerprint conflict;
- stale-version new request;
- concurrent same-key requests;
- relation duplicate conflict;
- disabled-user mutation rejection inside transaction;
- existing Memory/Diary/Task idempotent creates continue to pass.

Use ephemeral PostgreSQL created by the test/CI workflow. Do not use production DB.

If existing workflow path filters do not run an appropriate PostgreSQL gate for these changed paths, add the smallest Universe/MCP-write verification workflow or extend the appropriate existing verification workflow. Any PR workflow must explicitly checkout and verify the exact PR head SHA, following the exact-head pattern already established in the repository.

## Task 12 — Full deterministic verification

Before opening the Draft PR, run and report:

1. all new focused MCP Universe tests;
2. relevant existing Universe service/repository/Web-API/MCP-read regressions;
3. relevant MCP durable idempotency tests;
4. real PostgreSQL migration/integration/concurrency tests;
5. full canonical deterministic suite;
6. root typecheck;
7. root build;
8. Web typecheck;
9. Web build;
10. `git diff --check`;
11. worktree clean after commits.

Existing known non-blocking warnings must be reported rather than hidden. New failures/warnings caused by this PR must be fixed or explicitly blocked before review.

## Task 13 — Open a Draft PR, do not merge/deploy

The Draft PR must include:

- exact base SHA and final head SHA;
- the three tool contracts;
- idempotency migration summary;
- why ledger/resource create is atomic;
- replay-before-CAS semantics;
- MCP-only self-link restriction and confirmation that repository-wide behavior was not changed;
- partial update/revision semantics;
- full test/CI evidence;
- explicit statement that production DB was not touched;
- explicit non-goals.

Do not merge and do not deploy. Stop for review.

## Reviewer merge gate

Before merge, review must independently verify:

- final PR head is the reviewed head;
- base remains the expected current main or rebase changes are re-reviewed;
- complete changed-file list and patch match the frozen scope;
- migration is lossless and check constraints remain strict;
- resource+ledger writes are actually one transaction;
- replay lookup is before CAS;
- no duplicate resource/version bump on replay;
- no self-link repository-wide behavioral change;
- update cannot write hidden fields and uses `mcp_update` revision reason;
- exact tool annotations;
- exact-head hosted PostgreSQL/CI result if applicable;
- full canonical verification green.

## Post-merge production acceptance

Only after exact production deployment evidence:

1. fresh-read the current authoritative Universe version;
2. create temporary Node A with explicit position and unique idempotency key; fresh readback;
3. repeat the exact Node A create with the same key and request; confirm replay, no duplicate, and no replay-induced version bump;
4. update Node A using current version with a one-field partial patch; fresh readback and verify omitted fields preserved;
5. optionally exercise safe clear semantics (`tags: []` and/or `galaxies: []`) and verify readback;
6. issue one controlled stale-version update; confirm `VERSION_CONFLICT` and unchanged state;
7. create temporary Node B with a new key/current version; fresh readback;
8. create relation A -> B with current version/new key; fresh relation readback;
9. attempt A -> A self relation; confirm `RELATION_INVALID` and unchanged version/state;
10. attempt the same directional A -> B relation/type with a new key/current version; confirm `RELATION_CONFLICT` and unchanged state;
11. keep acceptance resources because delete is out of scope;
12. record whether any transport/session error occurred; for any uncertain mutation, fresh-read first and do not blindly repeat;
13. record the exact deployed SHA separately from application-level acceptance evidence.

Phase B is not production-accepted until these checks pass.
