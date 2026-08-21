# Universe Diary Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Follow this plan task-by-task and preserve the frozen Issue #209 contract. Do not make product decisions while implementing.

**Goal:** Add structured Diary → Universe provenance on the Universe side only: a Universe node may reference zero or more owned active/archived Diary entries, Web create/edit saves the exact source set atomically with the node under the existing Universe CAS, detail renders the frozen provenance timeline, the picker searches owned Diaries, and direct Diary navigation safely returns to the exact originating Universe node.

**Architecture:** Keep canonical `UniverseSnapshot`, revisions, backups, JSON export/import and MCP contracts unchanged. Persist provenance in a new relational table keyed by `(user_id, node_id, diary_id)`, join live Diary title/date/status for Web reads, and expose provenance through Web-only result/types and endpoints. Reuse the existing Universe version as the sole write CAS. Existing MCP paths continue using canonical Universe repository/service methods without a provenance surface. Whole-Universe replace/backup restore explicitly preserves current source rows for surviving node IDs.

**Tech stack:** PostgreSQL, Drizzle ORM, TypeScript, Express Web API, React 19, existing Node test runner and source/rendered UI contract tests.

**Frozen product contract:** GitHub Issue #209. If this plan conflicts with #209, #209 wins and implementation stops for clarification rather than inventing behavior.

## Global constraints

- Audited post-#208 baseline: `main@c711eca5f390c58b6ea65dad00f13f3fff07e3ba`.
- #208 is merged; PR #210 merge commit is the audited baseline above.
- This plan must be merged to `main` before implementation starts. Implementation must then fresh-read `main` and use that exact post-plan SHA as its base.
- Implementation branch exactly: `feat/universe-diary-provenance`.
- Do not reuse any historical `plan/diary-universe-provenance*` branch.
- One implementation branch/worktree only; no parallel #209 implementation branches and no force-push.
- Use TDD. Each behavioral task begins with a focused RED that fails for the intended missing contract before production code is changed.
- Current migration head is `0025_wild_xavin`; implementation should generate the next single Drizzle migration (`0026_*`) from the post-plan `main`. Do not hand-invent journal/snapshot lineage.
- Do not touch production DB during implementation or test setup. Database integration uses a disposable PostgreSQL instance only.
- Canonical `UniverseSnapshot`, `UniverseBackup.data`, node revision snapshots, Universe JSON export/import, Global Search Universe shape, MCP read/write schemas/tools and idempotency payloads remain provenance-free.
- No Diary backlink UI, Universe-map provenance badge, source title snapshot, source inference, body regex hiding, source count limit, connection-editor redesign or unrelated cleanup.
- Existing handwritten `来源日记：...` body text is not modified by generic code. Any later cleanup is a separately gated data operation on individually confirmed nodes only.

---

## Task 1 — Add the relational provenance schema with same-user cascade invariants

**Files**
- Modify: `src/database/schema.ts`
- Generate: `drizzle/0026_*.sql`
- Generate: `drizzle/meta/0026_snapshot.json`
- Modify generated journal: `drizzle/meta/_journal.json`
- Modify: `tests/universe-migration.test.ts`
- Modify/add focused PostgreSQL integration coverage alongside `tests/universe-repository.integration.test.ts` (use the existing integration-test convention; do not invent a new runner)

**Frozen schema**

Create `universe_diary_sources` containing only:
- `user_id uuid NOT NULL`
- `node_id text NOT NULL`
- `diary_id uuid NOT NULL`
- primary key `(user_id, node_id, diary_id)`

Enforce identity and ownership in the database:
- composite FK `(user_id, node_id)` → `universe_nodes(user_id, id)` with `ON DELETE CASCADE ON UPDATE CASCADE`;
- composite FK `(user_id, diary_id)` → `diary_entries(user_id, id)` with `ON DELETE CASCADE ON UPDATE CASCADE`;
- because `diary_entries.id` is globally primary-keyed but `(user_id, id)` is not currently a referenced unique key, add the minimum unique constraint/index required for the composite FK; do not change Diary identity semantics.

Do not add title/date/status snapshot columns, timestamps, ordering columns or JSON payloads to the relation.

### RED

Add focused migration/integration assertions proving the pre-change schema cannot satisfy:
- duplicate `(user,node,diary)` relation rejection;
- foreign-user node/Diary pair rejection;
- node delete cascades relation;
- Diary permanent row delete cascades relation;
- Diary status update active ↔ archived preserves relation.

Run the smallest existing migration/repository integration command that exercises these assertions and observe RED for the missing table/constraints.

### GREEN

Add the Drizzle schema and generate exactly one 0026 migration. Re-run the focused disposable-PostgreSQL tests. Verify the generated SQL contains only the required relation/constraint/index changes.

Commit schema/migration + focused invariant tests as one coherent GREEN commit after the RED evidence exists.

---

## Task 2 — Add Web-only provenance repository/service contracts and atomic node writes

**Files**
- Modify: `src/domains/universe/universe-repository.ts`
- Modify: `src/domains/universe/universe-repository-drizzle.ts`
- Modify: `src/domains/universe/universe-service.ts`
- Modify: `tests/universe-repository.integration.test.ts`
- Modify: `tests/universe-service.test.ts`
- Add/modify focused source contract tests only where current repository conventions require them

**New non-canonical types**

Define Web-side/domain-support types outside `UniverseSnapshot`:
- `UniverseDiarySourceSummary`: `{ nodeId, diaryId, title, date, status }`
- `UniverseDiarySourceOption`: `{ id, title, date, status }`
- `UniverseWebReadResult`: canonical `{ snapshot, version }` plus a separate `sources` collection.

Keep the existing canonical `UniverseReadResult` unchanged so MCP/core callers cannot accidentally inherit a provenance field.

**Repository methods**

Add explicit provenance-aware/Web methods rather than changing MCP semantics implicitly. Required behavior:
- list current source summaries for one user by joining `universe_diary_sources` to current `diary_entries` rows;
- search source options for one user across both active and archived Diary rows;
- create a node with an explicit source set in the same transaction/CAS/version bump;
- update a node with an optional source set in the same transaction/CAS/version bump.

Existing MCP methods (`createNodeIdempotently`, MCP update path and read contracts) remain provenance-unaware.

**Source-set validation**

At the service boundary:
- `source_diary_ids` must be an array when supplied;
- each value must be a syntactically valid Diary UUID/string accepted by the existing Diary identity contract;
- duplicate IDs reject the whole request;
- there is no product-level count limit.

At the repository boundary, before any source write:
- read all requested Diary rows under the same user;
- require exactly the requested unique set;
- active and archived both count as valid;
- missing/permanently-deleted/foreign-user IDs reject the whole transaction as `INVALID_UNIVERSE` (or the existing safe equivalent used by the Web router); no partial relation set is written.

**Atomic create**

For Web node create:
1. enter the existing active-user transaction;
2. assert `expected_version` once;
3. validate galaxy references and the full source set;
4. insert node;
5. insert exact source rows (none if omitted/empty; Web adapter will send explicitly);
6. bump Universe version exactly once;
7. return a fresh Web read result containing canonical snapshot/version + live source summaries.

If any step fails, node and source rows both roll back.

**Atomic update**

For Web node update:
1. enter the existing active-user transaction;
2. assert the existing CAS once;
3. load existing node, validate patch and galaxies as today;
4. write exactly one normal Universe revision containing canonical node state only;
5. if `source_diary_ids` is **omitted**, preserve current source rows unchanged;
6. if supplied, validate the entire requested source set, then replace the node's source rows with that exact set inside the same transaction;
7. update node;
8. bump Universe version exactly once;
9. return fresh Web canonical state + live source summaries.

Do not put provenance into revision snapshots.

**Whole-Universe replace/restore preservation**

The current `replaceCanonical()` deletes all Universe nodes, which would cascade provenance. Change that implementation deliberately:
- before deleting canonical nodes, compute incoming/surviving node IDs from the replacement snapshot;
- capture only current `universe_diary_sources` rows whose `node_id` is in that incoming set;
- run the existing canonical delete/reinsert;
- reinsert only those captured source rows after surviving nodes exist again;
- never preserve rows for node IDs absent from the incoming snapshot;
- never reconstruct sources from backup/snapshot JSON;
- if a Diary was permanently deleted before capture, its relation is already absent and must not reappear;
- FK/transaction failure must roll back rather than fabricate a relation.

This behavior must cover both whole-Universe save/replace and backup restore because both use the canonical replacement helper.

### RED/GREEN tests

Write focused failures first for:
- create with sources commits node + exact source set + one version bump;
- create invalid/duplicate/foreign/missing source rolls back node and version;
- update explicit set replaces exactly and bumps once;
- update omitted set preserves existing sources (protects non-Web/MCP callers);
- update explicit `[]` clears sources;
- failed CAS leaves node/sources/version unchanged;
- archive/restore preserves live summary relation/status changes naturally;
- Diary title/date edits appear on next read without provenance-row update;
- node delete and Diary permanent delete leave no ghost summaries;
- `saveUniverse` and `restoreBackup` preserve source rows only for surviving node IDs;
- deleted source relations are not resurrected by later restore/replace;
- canonical snapshot/revision/backup values contain no provenance fields.

---

## Task 3 — Extend only the Web Universe API surface

**Files**
- Modify: `src/web-api/universe-router.ts`
- Modify only if wiring requires it: `src/web-api/router.ts`
- Modify: `tests/universe-api.test.ts`

**GET `/universe`**

Keep `snapshot` and `version` exactly canonical and add `sources` as a sibling Web-only field. Each summary is exactly:
`{ nodeId, diaryId, title, date, status }`.

Do not nest source summaries under nodes and do not modify canonical validators.

**POST `/universe/nodes`**

Accept sibling `source_diary_ids`.
- omitted defaults to `[]`;
- pass source IDs only through the Web-specific create path;
- node payload remains canonical.

**PATCH `/universe/nodes/:nodeId`**

Accept sibling `source_diary_ids`.
- omitted means preserve current sources;
- explicit `[]` means clear;
- continue using the existing `expected_version` and reason behavior;
- no second provenance request and no second version bump.

**GET `/universe/diary-source-options?q=...`**

Add a Universe-owned picker endpoint. It must:
- require the active authenticated user through existing Web API/service boundaries;
- search both active and archived owned Diaries;
- trim one search string `q`;
- match Diary title, `YYYY-MM-DD` date text, or tags;
- never search Diary body content;
- return exactly `{ id, title, date, status }` rows;
- order newest → oldest using Diary date, then existing stable recent tie-breakers;
- cap at the existing Diary list maximum: 100 rows per query;
- allow empty query to return the newest owned options, still capped at 100.

API tests must prove ownership isolation, active+archived visibility, title/date/tag search, body-content non-match, 100 cap/order, malformed source rejection and create/update omission semantics.

No MCP router/tool/schema changes.

---

## Task 4 — Carry Web provenance through the Universe adapter without contaminating export

**Files**
- Modify: `web/src/pages/universe/universe-types.ts`
- Modify: `web/src/pages/universe/universe-adapter.ts`
- Modify: `web/src/pages/universe/universe-service.ts`
- Modify: `tests/universe-web-adapter.test.ts`
- Modify: `tests/universe-web-export.test.ts`

Add Web-only client types mirroring server summaries/options. Extend client `UniverseReadResult` with sibling `sources`; do **not** extend `UniverseSnapshot`.

Change the adapter/service contracts so:
- `loadUniverse()` retains `sources` in state instead of dropping them;
- create node always sends explicit editor-draft `source_diary_ids` (empty array when none);
- update node from the editor sends explicit editor-draft `source_diary_ids`;
- non-editor canonical updates such as map position may omit the field so server preserves sources;
- service state replacement retains fresh source summaries after each mutation;
- add a source-option search method calling `/universe/diary-source-options?q=...`.

`exportData()` must continue exporting only `current.snapshot` + existing `exportedAt`; assert no provenance appears in JSON export.

### RED/GREEN

First fail adapter tests for sibling source parsing, explicit create/editor-update source payloads and option search. Also fail export regression if provenance would leak. Then implement minimal adapter/service changes.

---

## Task 5 — Render the frozen provenance timeline in mobile and desktop detail

**Files**
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Modify existing Universe mobile/desktop CSS files only where required by the current Paper ownership; prefer the current `universe-node-detail-memory-shell.css` / focused Universe polish layers rather than a new visual system
- Modify focused rendered/source contract tests, including `tests/universe-mobile-node-paper.test.ts` and existing desktop Paper tests as appropriate

**Data flow**

For the selected node, derive its current source summaries from Web state by `nodeId` and pass them to `UniverseNodePaper` separately from the canonical node.

Sort the detail timeline by Diary date old → new with a deterministic ID tie-break. Format date exactly `YYYY.MM.DD`.

**Mobile detail order**

Preserve:
`title → summary → body → tags → galaxies → first-order connections → Diary provenance timeline → fixed footer`.

The timeline:
- renders only when at least one source exists;
- has no heading, empty state, divider, card, pill, icon, arrow, badge or new accent;
- thin vertical line `#30323b`;
- small non-glowing dot;
- date `10px`, title `11px`;
- date/title/dot use `#7d7f8c`;
- title one-line ellipsis;
- whole row is a button/click target;
- one source still renders line/dot timeline geometry.

Do not move the fixed detail footer or change existing title/summary/body/tag/galaxy/connection styling.

**Desktop**

Render the same provenance information in the existing desktop detail body after connections using the same subdued line/dot/date/title language adapted to the existing desktop Paper geometry. Do not invent a second card/panel style.

Write RED rendered/source tests for order, conditional absence, one-source case, exact typography/colors and click callback before implementation.

---

## Task 6 — Add the source field and secondary Paper picker to mobile create/edit

**Files**
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/universe/UniverseNodePaper.tsx`
- Add one focused Universe-owned picker component only if keeping it inside `UniverseNodePaper` would materially reduce clarity; do not create a generic cross-domain framework
- Modify existing mobile Universe CSS/polish files
- Modify focused editor tests, including `tests/universe-node-editor-card-system.test.ts` and `tests/universe-mobile-node-paper.test.ts`

**Editor draft ownership**

Extend `UniverseNodePaperDraft` with `sourceDiaryIds` (Web/UI only; never add it to `UniverseNode`).
- create initializes selected sources to `[]`;
- edit initializes from current source summaries for that node;
- switching node/mode resets the draft from current committed summaries;
- Universe editor cancel discards all source changes because local Paper state is thrown away/reset;
- save sends the exact selected IDs together with the node draft in one create/update request.

**Field placement and copy**

The source field is the final scrollable editor field after galaxy membership and before existing error/footer handling.
- label exactly `来源日记 · 可选`;
- selected chip text exactly `YYYY.MM.DD · 标题 ×`;
- use existing lightweight removable-chip language;
- button exactly `＋ 添加`.

**Secondary Paper picker**

Open a secondary Paper-style picker above/within the existing dialog system without replacing the main editor state.
- title `选择来源日记`;
- existing input styling;
- placeholder `搜索标题、日期或标签`;
- query the Universe-owned endpoint; do not fetch Diary body;
- result row uses date + title language;
- archived option remains selectable and shows a small muted `归档` status;
- results newest → oldest as returned by server;
- already-selected result is visibly selected and tapping again toggles it off;
- picker maintains a temporary selection copy.

Picker `取消`: discard picker-only changes and leave editor draft unchanged.
Picker `完成`: copy temporary selection into the editor draft only; do not write server state.

No large free-text source input and no product-level selection cap.

Write RED interaction/state tests for create/edit initialization, toggle, picker cancel/complete, editor cancel and save payload before production changes.

---

## Task 7 — Add direct Diary deep links and exact safe return-to-Universe behavior

**Files**
- Modify: `web/src/pages/universe/universe-location.ts`
- Modify: `web/src/pages/diary-location.ts`
- Modify: `web/src/pages/UniversePage.tsx`
- Modify: `web/src/pages/DiaryPage.tsx`
- Modify existing navigation/location tests and `tests/diary-page.test.ts`; add a focused cross-route regression if current conventions require it

**Universe return target helper**

Add one canonical sanitizer/helper for the exact location:
`/universe?node=<id>`.

Validation must be fail-closed:
- same-origin relative URL only (using the existing sentinel-origin pattern);
- pathname exactly `/universe`;
- exactly one query key and it is `node`;
- exactly one non-empty `node` value satisfying the existing safe node-ID syntax;
- reject duplicate `node`, any extra query key, fragments/unsafe origins and malformed values.

**Diary allowlists**

Extend both `getSafeDiaryReturnTo` and `getSafeDiaryArchiveReturnTo` to accept only the sanitized Universe-node target above in addition to their current allowed Diary/Search targets. Do not broaden the allowlist generically.

**Opening a source**

From Universe detail:
- active source → existing `createDiaryDetailLocation(diaryId, returnTo)`;
- archived source → existing `createArchivedDiaryDetailLocation(diaryId, returnTo)`;
- `returnTo` is the exact selected node location `/universe?node=<nodeId>`;
- navigate directly to detail, never to Diary list first and never embed a Diary preview in Universe.

**Returning from Diary**

For both active and archived direct detail, use the already-parsed safe `returnTo` for:
- close/back;
- archive active source;
- restore archived source;
- permanent-delete archived source.

After each successful lifecycle mutation from a deep link, navigate to the same safe Universe-node return target rather than first landing in a Diary list/archive view.

Archive/restore does not modify provenance relation. Permanent delete relies on the DB cascade and the next Universe read shows no source. If the Universe node was deleted while the Diary page was open, returning to `/universe?node=<old>` must leave Universe in its normal page state without fabricating detail; current `consumeUniverseNodeTarget` may open detail only when the node exists.

Write RED tests for active and archived close/archive/restore/permanent-delete returns plus unsafe origin, extra key and duplicate-key rejection.

---

## Task 8 — Lock non-regressions, full verification, and Draft PR

**Required focused coverage before canonical run**

Run the exact existing/focused suites touched above, including at minimum:
- Universe migration/repository/service/API tests;
- Diary permanent-delete + navigation/location tests;
- Universe Web adapter/export/page/editor/mobile detail tests;
- existing MCP Universe read/write tests proving no schema/result change;
- existing backup/restore and revision tests.

If a focused test exposes a frozen-contract conflict, stop and report it; do not widen scope.

**Canonical verification**

Run from repository root:

```bash
CI=true pnpm test
pnpm typecheck
pnpm build
pnpm --dir web typecheck
pnpm --dir web build
pnpm db:check
git diff --check
git status --short
git diff --name-only origin/main...HEAD
```

For DB integration, run the relevant repository/migration/permanent-delete suites against disposable PostgreSQL using the repository's existing env gates. Record exact pass/fail/skip counts and remove the disposable DB afterward. Production DB touched: **NO**.

**Diff audit before PR**

Reject the implementation if any of the following occurs:
- provenance appears inside canonical Universe node/snapshot/revision/backup/export/MCP JSON;
- MCP schemas/tools/registration are changed;
- create/update uses a second provenance request or second Universe version bump;
- update omission clears sources;
- archive/restore deletes source rows;
- whole-Universe replace/restore drops surviving source rows or resurrects deleted ones;
- Diary body is searched by the picker;
- navigation allowlists accept generic `/universe` URLs, extra keys, duplicate keys or unsafe origins;
- source timeline adds a heading/card/badge/accent or changes frozen order;
- editor source field is not last in the scroll body;
- connection editor, map badges, Diary backlink UI or unrelated visual cleanup changes;
- generic regex mutates handwritten body provenance.

**Draft PR only**

Open a Draft PR from `feat/universe-diary-provenance` to `main` with:
- Issue #209 reference;
- exact implementation base SHA;
- RED commit/evidence per task;
- migration name and disposable-DB evidence;
- focused + canonical counts;
- root/Web typecheck/build and `db:check` results;
- explicit statement that production DB was not touched;
- explicit statement that canonical Universe/MCP/export/backup/revision contracts remain provenance-free.

Do not merge or deploy the implementation PR. ChatGPT reviews exact head/diff/status and the user performs/approves visual acceptance before any merge/deploy gate.
