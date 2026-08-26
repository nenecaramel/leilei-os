# MCP Response Contract Hygiene Design

## Status

Approved in chat on 2026-08-26 as Phase 1 of the broader MCP UX / contract program. Written for repository review before implementation planning.

This spec freezes **Phase 1 only**. Later phases remain separate implementation cycles:

1. response contract hygiene — this spec;
2. machine-readable tool error envelopes;
3. discovery pagination and count semantics;
4. targeted Universe relation/provenance backend reads;
5. privacy-safe MCP observability.

The phases are intentionally not merged into one large PR.

## Goal

Make LeileiOS easier and cheaper for an AI client to operate by tightening the contracts it sees at tool-selection and tool-result time, without changing canonical business behavior.

Phase 1 has four user-visible/model-visible outcomes:

1. large Memory / Diary / Universe writes return compact success receipts instead of echoing long bodies;
2. routing-sensitive tools state when to use them, when not to use them, whether they return discovery or full detail, and the normal next tool;
3. deterministic discovery results expose machine-readable exact-detail pointers where the next step is unambiguous;
4. contract regression tests prevent future changes from silently reintroducing body echo, stale descriptions, missing pointers, or duplicate structured payloads.

No new MCP tool is added and no existing tool is renamed or removed.

## Baseline

The code-truth baseline is `main` commit `ee3971b748ce5c7e991caeaa78b06bd6dd952d5a`, which exposes 42 production MCP tools.

The preceding audit established the following Phase 1 problems.

### Long-body success receipts

- `write_memory` returns the complete Memory `content`; Memory content may now be 100,000 canonical JavaScript string units.
- `update_memory` returns the complete Memory `content`, even when the update only changes metadata.
- `update_diary` returns the complete Diary `content`, even when the update only changes metadata.
- `create_universe_node` and `update_universe_node` return the complete node, including `summary` and `content` and other fields that do not need to be repeated in a mutation acknowledgement.
- `write_diary` is already the positive pattern: its create receipt returns identity/metadata but not the Diary body.

### Missing deterministic detail pointers

- `list_tasks` intentionally omits Task description and tells the caller in prose to use `get_task`, but each item does not expose `detail_tool/detail_arguments`.
- `search_notion` tells the caller in prose to use `read_notion_page`, but each result does not expose `detail_tool/detail_arguments`.

Memory, Diary, Universe, and global-search discovery already demonstrate the preferred machine-readable pointer pattern.

### Routing descriptions drift

Tool descriptions are unevenly useful as routing contracts. Several already explain the next step well, while others only state capability.

There are also concrete description/schema contradictions:

- `create_task` says it is a persistent **non-idempotent** write although it requires `idempotency_key`, calls `createTaskIdempotently`, and declares `idempotentHint: true`.
- `toy_stop` says it accepts no parameters although its schema requires `idempotency_key`.
- `write_memory` still describes `get_memory` as active-only for an archived idempotent replay, but `get_memory` now supports both `scope=active` and `scope=archived`.

### Small duplicate text payloads

`get_local_context` and `get_weather_context` serialize the same structured result into MCP text content while also returning it in `structuredContent`. The data is small, so this is not a performance blocker, but it is an unnecessary exception to the dominant short-text + structured-data pattern.

## Design Principles

1. **Mutation receipts confirm; detail tools explain.** A write response should confirm stable identity, lifecycle/version/replay evidence, and the exact detail route. It should not re-deliver a large authoritative body.
2. **Do not replace body echo with truncation.** A mutation receipt must not return a misleading shortened `content` or `summary`. Full authoritative content remains an exact-detail concern.
3. **Pointers are deterministic, not advisory prose.** When the next exact-detail tool and arguments are mechanically known, expose them as data.
4. **Descriptions are model routing contracts.** Routing-sensitive descriptions state use-case, exclusion/alternative, result granularity, and next step. Unrelated tools are not cosmetically rewritten.
5. **Routing edits must preserve safety instructions.** Existing consent requirements, ownership boundaries, idempotency/CAS rules, destructive-operation warnings, no-blind-retry guidance, and provider/tool capability restrictions remain present unless this spec explicitly corrects a factual contradiction.
6. **Preserve business semantics.** Ownership, lifecycle, idempotency, CAS/version, state machines, provider behavior, and Web contracts do not change in this phase.
7. **Test invariants, not English style.** Contract regression tests assert concrete schema/result/annotation properties. Do not build a brittle generic natural-language linter.
8. **No hidden scope merge.** Machine-readable errors, pagination/count changes, Universe backend query optimization, and observability remain later phases.

## 1. Compact Mutation Receipts

### `write_memory`

Keep the existing top-level shape `success + data.memory + data.metadata`, but remove `data.memory.content` from the MCP output schema and returned `structuredContent`.

Preserve these Memory receipt fields:

- `id`
- `category`
- `key`
- `tags`
- `source`
- `lifecycle_status`
- `created_at`
- `updated_at`
- `author`

Preserve:

- `metadata.created`
- `metadata.idempotent_replay`

Add to `data`:

- `detail_tool: "get_memory"`
- `detail_arguments: { id, scope }`, where `scope` exactly matches the returned `lifecycle_status` (`active` or `archived`).

This makes archived idempotent replays actionable instead of treating `get_memory` as active-only.

The domain service may continue returning its current full create result internally. Phase 1 projects that result at the MCP adapter; it does not redesign persistence or service return types merely to save internal allocations.

### `update_memory`

Remove `content` from the successful MCP output. Preserve the existing non-body fields:

- `id`
- `category`
- `key`
- `tags`
- `source`
- `updated_at`
- `lifecycle_status: "active"`
- `author`

Add:

- `detail_tool: "get_memory"`
- `detail_arguments: { id, scope: "active" }`

The update service may continue returning full detail internally in this phase; only the MCP receipt projection changes.

### `update_diary`

Remove `content` from the successful MCP output. Preserve:

- `id`
- `title`
- `date`
- `tags`
- `mood`
- `created_at`
- `updated_at`
- `lifecycle_status: "active"`
- `author`

Add:

- `detail_tool: "get_diary"`
- `detail_arguments: { id, scope: "active" }`

`write_diary` remains unchanged in body behavior because it already does not echo Diary content.

### `create_universe_node`

Replace the full-node success payload with an identity/version receipt.

`data.node` contains only:

- `id`
- `title`
- `type`
- `createdAt`
- `updatedAt`

Do not return `summary`, `content`, `tags`, `galaxies`, `position`, `importance`, or `migration` in the mutation receipt. Those fields are either caller-supplied semantic data or full-detail data and remain available through `get_universe_node`.

Preserve:

- `universe_version`
- `metadata.created`
- `metadata.idempotent_replay`

Add to `data`:

- `detail_tool: "get_universe_node"`
- `detail_arguments: { id }`

The existing expected-version and idempotency behavior is unchanged.

### `update_universe_node`

Use the same compact node receipt fields as create:

- `id`
- `title`
- `type`
- `createdAt`
- `updatedAt`

Preserve `universe_version` and add:

- `detail_tool: "get_universe_node"`
- `detail_arguments: { id }`

Do not return the full node semantic body in the success receipt.

The current service path may still load/return a whole snapshot internally. Removing that hidden backend cost belongs to Phase 4, not this phase.

### Task receipts

Do **not** redesign `create_task`, `update_task`, or `transition_task` success payloads in Phase 1. Task description is bounded at 5,000 and the audit ranked it below the 100k-body/full-node receipts. Their routing descriptions may be corrected where needed, but receipt redesign is deferred unless implementation discovers a required compatibility fix.

## 2. Deterministic Detail Pointers

### `list_tasks`

Each returned Task list item adds:

- `detail_tool: "get_task"`
- `detail_arguments: { id }`

The list continues to omit Task `description`. Filters, ordering, limits, count behavior, Task lifecycle semantics, and `get_task` output are unchanged.

### `search_notion`

Each returned Notion page result adds:

- `detail_tool: "read_notion_page"`
- `detail_arguments: { page_id: id }`

Search remains title-only. This phase does not turn it into body full-text search and does not change Notion provider pagination.

### No synthetic pointers

Do not add a detail pointer where there is no exact deterministic detail tool. In particular, Phase 1 does not invent relation-detail or generic Todo-detail tools merely for symmetry.

## 3. Routing Description Contract

Phase 1 rewrites **routing-sensitive** descriptions, not all 42 descriptions for cosmetic consistency. Every rewrite must preserve the existing safety and capability restrictions that are still true.

The following decision paths must be explicit to the model.

### Cross-domain

`global_search`:

- use when the target may be in Memory, Diary, Task, or Universe and the caller does not know the domain;
- when the domain is already known, prefer that domain's discovery/search tool;
- results are compact and callers should follow returned detail pointers only for selected records;
- Notion and Todo are not silently implied to be covered if they are not part of global-search modules.

### Memory

`read_memory`:

- use for query-free/focused browsing by categories or known exact keys;
- use `search_memory` when searching Memory by text;
- result is compact discovery; use `get_memory` for full content.

`search_memory`:

- use for text search within Memory;
- use `read_memory` for category/exact-key browsing without a search query;
- result is compact; use returned `get_memory` pointer for selected records.

`get_memory`:

- use only when an exact Memory ID is already known from discovery/search/write receipt or another trusted LeileiOS result;
- it is the authoritative full-content read and supports explicit active/archived scope.

`write_memory` / `update_memory`:

- preserve the existing explicit-confirmation / safe-write requirements and no-blind-retry guidance;
- success result is a compact receipt;
- use returned `detail_tool/detail_arguments` when authoritative readback is needed;
- archived idempotent replay uses `get_memory` with `scope=archived`, not a stale “active-only” warning.

### Diary

`search_diary`:

- use for Diary browsing/filtering/text search because there is no separate Diary list tool;
- result is compact and `get_diary` is full detail.

`get_diary`:

- use only with an exact Diary ID;
- returns authoritative full content for the selected scope.

`update_diary`:

- preserve its existing no-blind-retry guidance;
- success receipt is compact; use the returned detail pointer when full readback is needed.

### Task

`list_tasks`:

- use for browsing/searching/filtering Tasks;
- Task descriptions are intentionally omitted;
- use each item's `get_task` pointer for exact detail.

`get_task`:

- use when an exact Task ID is known and complete Task detail is required.

`create_task`:

- preserve due-time/timezone and server-owned-status guidance;
- describe the write as idempotent with a required stable `idempotency_key`;
- remove the false “non-idempotent” claim.

### Universe

`list_universe_nodes`:

- use for query-free Universe browsing;
- use `search_universe` when a text query exists;
- result is compact and `get_universe_node` is exact full detail.

`search_universe`:

- use for text search inside Universe;
- use `list_universe_nodes` for query-free browsing;
- follow `get_universe_node` pointers only for selected nodes.

`get_universe_node`:

- use only with an exact canonical node ID;
- returns full selected node content.

Create/update node descriptions must preserve expected-version, idempotency and no-blind-retry guidance while making clear that success is a compact receipt and the returned detail pointer is the exact read route when full state is needed.

### Notion

`search_notion`:

- remains title search, not page-body full-text search;
- use for finding a page when an exact page reference is not known;
- use returned `read_notion_page` pointer for content.

`read_notion_page`:

- use with an exact page ID/URL to read page content;
- child pages/databases are not recursively expanded, preserving its existing boundary.

### Todo

`list_todo_dates` and `read_todo_day` descriptions should make their browse-then-read relationship explicit. No output-shape/pagination redesign is included; that belongs to Phase 3.

### Toy

`toy_stop` must preserve its existing device/payload safety restrictions and state that it requires an `idempotency_key`. Remove the false claim that it accepts no parameters. Toy command behavior is otherwise unchanged.

## 4. Small Duplicate Structured-Output Cleanup

For `get_local_context` and `get_weather_context`:

- keep existing `structuredContent` schemas and data unchanged;
- replace JSON-stringified text copies with short acknowledgement text such as `Local context retrieved.` / `Weather context retrieved.`;
- do not move any required data out of `structuredContent`.

This is a consistency cleanup, not a change to the underlying context/weather data source.

## 5. Contract Regression Guardrails

Tests must exercise actual registered MCP tool contracts/results rather than only helper functions.

### Long-body response-size regression

For each of:

- `write_memory`
- `update_memory`
- `update_diary`
- `create_universe_node`
- `update_universe_node`

use a service fixture containing a unique body sentinel. For Memory and Diary, use a 100,000-unit body. For Universe adapter tests, the stubbed service result may also contain a 100,000-unit `content`/large `summary` solely to prove that the MCP projection does not echo service-layer body size; this does **not** create a new canonical Universe content-limit requirement.

Assert:

1. the body sentinel/full body does not appear in MCP text content;
2. the body field does not appear in the successful structured receipt;
3. the expected detail pointer is present and points at the exact returned ID;
4. compared with an otherwise identical tiny-body fixture, UTF-8 byte size of the serialized successful receipt grows by **no more than 1,024 bytes**.

The fixed 1,024-byte delta is a regression allowance, not a product response-size quota. It catches linear body echo while allowing harmless formatting/metadata differences.

### Pointer regression

- `list_tasks` items expose `get_task` with the exact item ID.
- `search_notion` results expose `read_notion_page` with the exact returned page ID.
- Existing Memory/Diary/Universe/global-search detail pointers remain green.

### Description/schema alignment regression

Add targeted assertions for machine-checkable facts, including:

- `create_task` requires `idempotency_key` and retains `idempotentHint: true`; its description must not call the operation non-idempotent.
- `toy_stop` requires `idempotency_key`; its description must not claim it accepts no parameters.
- `write_memory` archived replay returns `detail_tool=get_memory` with `scope=archived`.

Do not implement a general English parser or generic “description quality score”.

### Utility duplicate-output regression

`get_local_context` and `get_weather_context` keep full structured data but their text content is a short acknowledgement rather than a JSON serialization of the same payload.

### Inventory regression

The Phase 1 production tool inventory remains 42 tools. Existing inventory coverage should be updated/extended to ensure this phase does not accidentally rename, remove, or add tools.

An intentional future tool addition may update this invariant in its own approved change; the test is not a permanent architectural ban on adding tools.

## Compatibility

### Deliberate MCP output changes

The successful output schemas for these tools deliberately become compact:

- `write_memory`
- `update_memory`
- `update_diary`
- `create_universe_node`
- `update_universe_node`

Any client that previously treated a mutation response as an authoritative full read must follow the returned exact-detail pointer instead.

`list_tasks` and `search_notion` gain additive fields only.

Tool names, input schemas, canonical persistence, Web APIs, ownership/lifecycle rules, idempotency/CAS behavior, and provider boundaries are preserved.

### Error behavior

Phase 1 does not redesign errors. Existing success/error behavior must remain compatible except where stale descriptive text is corrected.

Machine-readable error envelopes are Phase 2.

## Non-Goals

Phase 1 does not:

- add or remove MCP tools;
- rename stable MCP tools;
- add a router/super-tool;
- create a generic natural-language contract linter;
- add machine-readable error envelopes;
- add cursor pagination to Memory, Diary, Task, or Todo;
- change `count` semantics;
- optimize Universe relation/provenance reads or mutation repository return types;
- add MCP observability/logging;
- add chunk/range full-content reads;
- add batch exact-detail reads;
- redesign tags / matched-fields;
- change database schema or run migrations;
- change Web UI/API behavior;
- alter Task/Todo/Universe canonical business semantics.

## Acceptance Criteria

Phase 1 is accepted only when all of the following are true.

1. The five targeted long-body/full-node mutation tools no longer return full semantic bodies in successful MCP receipts.
2. Each compacted mutation receipt contains enough stable identity/version/replay evidence for the existing write semantics plus an exact detail pointer where an exact detail tool exists.
3. A 100k Memory/Diary fixture cannot make the corresponding successful MCP receipt grow linearly with the body; the specified large-vs-small serialized receipt delta stays within 1,024 bytes.
4. `list_tasks` returns deterministic `get_task` pointers for every item.
5. `search_notion` returns deterministic `read_notion_page` pointers for every result.
6. Routing-sensitive descriptions clearly distinguish browse/search/detail routes, including `global_search` versus known-domain search, while preserving existing safety constraints.
7. The `create_task`, `toy_stop`, and archived-`write_memory` description/schema drift is fixed.
8. Local/weather context no longer duplicates the structured object as JSON text.
9. The production tool inventory remains 42.
10. Existing domain, lifecycle, idempotency/CAS, Notion, Universe, global-search, MCP server/router, and Web regression suites remain green.
11. No database migration, Web behavior change, new MCP tool, or unrelated refactor is present in the implementation diff.

## Later Phases

After Phase 1 is production accepted, continue the approved program as separate specs/plans/PRs:

- **Phase 2:** shared machine-readable safe tool error envelope while keeping MCP transport/JSON-RPC errors separate;
- **Phase 3:** opaque pagination and explicit returned/total-count semantics for incomplete discovery surfaces;
- **Phase 4:** targeted Universe relation/provenance reads and compact internal mutation receipts without breaking Web whole-graph reads;
- **Phase 5:** privacy-safe MCP call observability (`tool_name`, latency, outcome/safe error code, approximate bytes, call sequence) with no Memory/Diary bodies or sensitive raw payloads.

Contract regression coverage is a cross-phase guardrail: each later phase extends the contract tests for the invariants it introduces instead of leaving testing as a sixth cleanup phase.
