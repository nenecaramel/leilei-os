# MCP Universe Writes — Frozen Design

Date: 2026-08-21
Status: Frozen for implementation
Branch: `feature/mcp-universe-writes`
Base: `main@70a5882c71eac1dfb47dd241079efd524c721cf4`

## Goal

Add the first safe ChatGPT/MCP write surface for Universe by exposing exactly three command-shaped tools:

- `create_universe_node`
- `update_universe_node`
- `create_universe_relation`

The design must reuse the existing Universe service/repository invariants and the existing durable MCP create-idempotency infrastructure. GitHub remains the code source of truth; production runtime evidence is required after merge/deploy before this phase is accepted.

## Non-goals

This change does not add or expose:

- node delete
- relation delete
- full-Universe save/replace
- revision restore
- backup create/restore
- migration metadata writes
- `importance` writes
- arbitrary revision reasons
- relation update/upsert
- automatic layout/placement
- low-level/raw graph writes
- Web UI changes
- MCP SDK/session-lifecycle changes
- unrelated refactors
- direct production database writes during implementation or CI

## Existing domain facts that remain authoritative

- Universe mutations use an explicit non-negative `expected_version` CAS contract.
- `UniverseRepository` mutations execute in a transaction and retain the durable active-user guard.
- `updateNode` records the previous node snapshot as a revision before updating.
- canonical node position is a logical `0..100` coordinate space in each dimension.
- canonical relation types are exactly:
  - `related_to`
  - `supports`
  - `contradicts`
  - `extends`
  - `part_of`
  - `raises`
- existing Web relation UI forbids selecting the source node as its own target and constrains strength to `0..1`.
- the repository historically permits a self relation if the referenced node exists. This PR must not change that repository-wide historical behavior; the new MCP surface rejects self relations at its boundary.

## Tool contracts

### `create_universe_node`

Required caller-controlled fields:

- `title: string`
- `summary: string`
- `content: string`
- `type: string`
- `tags: string[]`
- `galaxies: Array<{ id: string; weight: number }>`
- `position: { x: number; y: number }`
- `expected_version: non-negative integer`
- `idempotency_key: string`

Rules:

- `position.x` and `position.y` must each be finite and inside `0..100`, inclusive.
- No silent clamping.
- The caller cannot supply `id`, `createdAt`, `updatedAt`, `importance`, or `migration`.
- The server/domain generates the stable `node-<uuid>` ID and timestamps.
- Existing node validation remains authoritative for title/summary/content/type/tags/galaxy membership semantics and galaxy reference integrity.
- A new logical create requires a new idempotency key.

Success returns the authoritative created/replayed node plus `universe_version`; it must not return the entire Universe snapshot.

Safety annotation:

```ts
{
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

### `update_universe_node`

Required routing/concurrency fields:

- stable node `id`
- `expected_version: non-negative integer`

Allowed patch fields only:

- `title`
- `summary`
- `content`
- `type`
- `tags`
- `galaxies`
- `position`

Rules:

- Partial patch semantics: omitted fields remain unchanged.
- Empty patch is invalid.
- `tags: []` explicitly clears tags.
- `galaxies: []` explicitly clears galaxy memberships.
- Empty strings remain legal only where the existing Universe domain already permits them (for example `summary` and `content`); `type` remains non-blank per current domain validation.
- If `position` is supplied, both coordinates must be finite and within `0..100`, inclusive; no silent clamp.
- `id`, timestamps, `importance`, and `migration` are not writable.
- Caller does not supply an audit/revision reason. The server uses the fixed reason `mcp_update`.
- No durable create-idempotency ledger entry is added for update.
- A stale `expected_version` produces `VERSION_CONFLICT`; never automatically retry.

Success returns the authoritative updated node plus the new `universe_version`, not the whole Universe snapshot.

Safety annotation:

```ts
{
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}
```

### `create_universe_relation`

Required caller-controlled fields:

- `source: string`
- `target: string`
- `relation_type: one of the six canonical relation types`
- `strength: number`
- `expected_version: non-negative integer`
- `idempotency_key: string`

Rules:

- `strength` must be finite and inside `0..1`, inclusive.
- `source` and `target` must resolve to existing nodes for the active user.
- MCP rejects `source === target` as `RELATION_INVALID` even though the repository historically permits self relations.
- No upsert.
- A duplicate directional `(source, target, relation_type)` created with a new logical request remains `RELATION_CONFLICT`.
- The caller cannot supply relation ID or timestamp; the server/domain generates `edge-<uuid>` and `createdAt`.

Success returns the authoritative created/replayed relation plus `universe_version`, not the whole Universe snapshot.

Safety annotation:

```ts
{
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
```

## Version/CAS contract

Every one of the three MCP mutations requires caller-supplied `expected_version`.

- No MCP/service layer fresh-read may silently replace the supplied version with the latest one.
- A new mutation with a stale version returns `VERSION_CONFLICT`.
- `VERSION_CONFLICT` is not automatically retried.
- The caller must fresh-read authoritative Universe state/version before deciding whether to issue a new mutation.

For durable create replay, the idempotency-ledger lookup occurs before the create-path CAS check. Therefore an exact replay of a successful create can return the original resource even though the first create already bumped the Universe version.

## Durable create idempotency

### One shared ledger

Continue using `mcp_write_idempotency` as the only durable MCP create-idempotency ledger. Do not create a Universe-specific second ledger.

Extend the existing type/check-constraint allowlists with:

Tool types:

- `create_universe_node`
- `create_universe_relation`

Resource types:

- `universe_node`
- `universe_relation`

### Resource ID migration

The existing ledger stores `resource_id` as PostgreSQL `uuid`, while Universe IDs are prefixed strings such as `node-<uuid>` and `edge-<uuid>`.

Generate the repository's next normal Drizzle migration after `0024_brainy_wildside` to change:

- `mcp_write_idempotency.resource_id: uuid -> text`

The migration must preserve every existing UUID value losslessly using an explicit text cast and update schema/check constraints consistently. Existing Memory/Diary/Task create replay behavior must remain unchanged.

### Atomicity

Do not compose `UniverseService.createNode/createRelation` and a separate ledger write in the MCP register layer. That would make the resource create and durable replay record non-atomic.

Instead, extend the Universe domain/repository with MCP-specific idempotent create operations analogous to the existing Memory MCP create pattern. Within one DB transaction:

1. acquire the existing per-user/tool/idempotency-key advisory transaction lock;
2. check the ledger for an existing key;
3. if found, validate the request fingerprint and return replay semantics without another create/version bump;
4. otherwise retain the durable active-user guard;
5. validate/assert the caller's `expected_version`;
6. perform the existing node/relation create invariant checks and insert;
7. bump the Universe version exactly once;
8. insert the durable idempotency ledger record containing the generated text resource ID;
9. return authoritative state.

A transaction failure must leave neither a created resource without a ledger row nor a ledger row without its resource.

### Fingerprints and replay

- Fingerprints contain only stable caller-controlled request data, including `expected_version`.
- Generated IDs/timestamps never enter the fingerprint.
- Same key + same fingerprint => replay; no duplicate resource and no new Universe version bump.
- Same key + different fingerprint => existing `IDEMPOTENCY_KEY_REUSED` contract.
- Reusing the same key after rereading and changing `expected_version` is a different fingerprint and therefore a key-reuse conflict. A new logical create requires a new key.
- On replay, resolve the stored resource ID from current authoritative Universe state and return that resource with the current authoritative `universe_version`.
- If the ledger exists but the stored resource no longer exists because another surface removed it, fail closed with the corresponding not-found/error condition. Never recreate the resource from a ledger hit.

## Boundary validation versus domain validation

MCP adds only the product-boundary restrictions intentionally frozen for this phase:

- node position `0..100`
- relation strength `0..1`
- relation self-link forbidden
- strict exposed field sets / no caller IDs or timestamps

Do not broaden these into unrelated repository-wide behavior changes unless necessary to share a safe validation helper without changing existing callers' accepted inputs.

Existing Universe service/repository remains authoritative for:

- active user/ownership
- expected-version CAS
- node existence
- galaxy references
- duplicate directional relation conflict
- revision creation on node update
- database transaction semantics

## Error and retry contract

Preserve and surface the established Universe error classes as applicable, including:

- `VERSION_CONFLICT`
- `NODE_NOT_FOUND`
- `RELATION_INVALID`
- `RELATION_CONFLICT`
- `INVALID_UNIVERSE`
- active-user disabled/not-found/unavailable classes

Preserve the existing MCP durable-idempotency key-reuse error for create requests.

No mutation may blindly retry after an uncertain transport/session outcome. The recovery rule is:

1. fresh-read authoritative state;
2. determine whether the mutation landed;
3. only then decide whether a new logical mutation is required.

Exact create replay with the same idempotency key remains safe according to the durable replay contract, but higher-level recovery should still prefer authoritative readback when the caller can identify the target/result.

## Authoritative readback/output

Successful tools return compact mutation results:

- create node: `node` + `universe_version` + create/replay metadata consistent with existing MCP create tools
- update node: `node` + `universe_version`
- create relation: `relation` + `universe_version` + create/replay metadata consistent with existing MCP create tools

Results must be selected from the authoritative transaction result or a fresh authoritative read, never synthesized by echoing input fields. Do not return the entire Universe snapshot from these tools.

## Production acceptance

After expected-head merge and exact production deployment evidence:

1. fresh-read current Universe version;
2. create a temporary node at an explicit `0..100` position and verify authoritative readback;
3. exact same idempotent create replay and verify no duplicate/no version bump caused by replay;
4. update that node with current version using a partial patch; verify omitted fields preserved and intended clear semantics where exercised;
5. controlled stale-version update must return `VERSION_CONFLICT` and leave state unchanged;
6. create a second temporary node;
7. create a relation between the two nodes and verify authoritative relation readback;
8. self relation must be rejected without mutation;
9. a duplicate directional relation with a new idempotency key must return `RELATION_CONFLICT` without mutation;
10. keep acceptance resources because delete is not part of this phase;
11. if any mutation outcome is uncertain due to transport/session failure, do not blindly retry; fresh-read first.

No implementation/CI step may use production database credentials or write production acceptance data before merge/deploy.
