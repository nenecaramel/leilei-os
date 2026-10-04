# Claude Turn Lifecycle Implementation Plan

> Execute inline with superpowers:executing-plans; one fresh independent whole-branch reviewer at completion.

**Goal:** One stable visible message tree from Send/Retry/Edit through runtime, canonical, recovery and background updates.
**Architecture:** Foundation turn identity coordinator and conversation assembler select the sole body/Activity backing. AppModel owns reconciliation and per-stable-row UI state; SwiftUI renders the assembled rows. Geometry/follow/viewport anchoring are separate deterministic state models.
**Tech Stack:** Existing Swift/Foundation/SwiftUI and A–E+G presentation pipeline; no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-04-claude-turn-lifecycle.md (complete user-supplied requirements).
**Base:** b9e0d1be1286b170a93c72f58bfd262a0b82ec98 after explicit fetch.

## Global constraints
- Do not modify canonical IDs, A/D authority, E parsing, G sandbox, attachment/schema/provider/bridge contracts or protected workflow files. F remains deferred. PR only, no merge.
- Bind operation UUID/prepare/request/user/assistant only through actual lineage. No text/time/latest-assistant heuristics.
- Edit/retry atomically replace downstream current path. Failures roll back optimistic edits while retaining real failed runtime content.
- Stable row and rich-child namespace must coexist with unchanged source blocks/provenance/citation identities.
- Duration freezes on provider result; timestamps freeze after display and reload from authoritative durable start. Backend extension only after a proven durable gap.
- Baseline full suite first, PR full suite last, same Node24 environment, compare failure names; no incidental historical fixes.
- Mainline3/C/G physical acceptance pending; unsigned Simulator and real Swift models required.

## Review focus
1. Prepared response arriving before canonical user replacement: no duplicate old/new user or assistant in any reducer frame.
2. Retry on an older turn and delayed observation of a previous prepare: lineage isolation and one replacement slot.
3. Runtime removal before canonical refresh or polling failure: retain last body/Activity, not empty rows.
4. Pending input resolved after manual collapse/expand: preserve explicit user intent, child IDs and open details.
5. Prepend/edit while reading above bottom: retain visible row relative offset and never steal scroll.

### Task1: Turn identity / assembler / lifecycle
- [x] RED real Swift per-frame Send/Edit/Retry/recovery/body mismatch tests, including first pending frame and canonical-before-runtime order.
- [x] Move pending operation into Foundation; add runtime client lineage fields from prepare/active response.
- [x] Implement row/turn presentations, actual lineage coordinator, deterministic assembler, retained last backing and activity overlay by stable child identities.
- [x] Add unified phase/header/duration/timestamp selection; inspect durable timestamp gap and record minimum remedy if necessary.
- [x] GREEN compiled Swift intermediate-frame regressions; commit.

### Task2: UI state and scroll models
- [x] RED expansion/voice/copy state, scroll geometry/follow/event neutrality, exact viewport anchor and loading/stale snapshot fixtures.
- [x] Implement per-stable-ID UI state and geometry/follow state; memory bounded/reset at logout, preserve manual intent.
- [x] GREEN deterministic actual model tests; commit.

### Task3: AppModel / fixed SwiftUI rows
- [x] RED removed-multi-owner integration and rich namespace regressions.
- [x] AppModel owns pending/assembler reconciliation; prepare callback binds real lineage before observation. Recovery/background share the same assembly.
- [x] Simplify MessageSurface to ForEach assembled rows; fixed user/assistant views consume presentation and state bindings only.
- [x] Remove replacement hidden overlay/runtime-owner paths/typing row; Activity view only consumes unified projection/header and external expansion state.
- [x] Preserve copy/edit/retry/sheets/Mind/Album/C media and stable rich children through backing handoff.
- [x] Integrate atomic viewport anchor and persistent follow semantics; preserve stale snapshots/initial loading.
- [x] GREEN model/integration compatibility and unsigned Simulator; commit.

### Task4: Durable timestamp if required
- [x] Prove from real prepare/finalization/read paths whether start time survives retention; RED live/reload/retention test.
- [x] Add only needed authoritative start-time metadata/response projection without schema/provider changes if evidence requires it.
- [x] GREEN isolated Postgres retention integration and client timestamp tests; commit or record no extension needed.

### Task5: Full validation / review / PR
- [x] A–G focused, voice/question/duration/ordinary-hidden-ambient Activity, current path/edit/retry/background/history/fork/attachment; relevant isolated PG.
- [x] Runtime gate, complete bridge, typecheck/generated/build/Web gates/diff/unsigned Simulator.
- [x] Fresh independent review; Important fixes RED→GREEN and relevant gates rerun.
- [x] Sequential exact-main baseline vs PR full suite; report totals and added/removed failure names.
- [x] Open `refactor: unify Claude turn lifecycle rendering`, exact SHAs and all requested contract/acceptance evidence, no merge.
- [x] Commit/push/attach; hygiene and task-only temporary cleanup, stop for review.

## Evidence / rulings
- User supplied the full architectural spec and authorized implementation/PR. Execute in this session without repeating design approvals; preserve the supplied spec verbatim.
- Existing multi-owner paths and hidden overlay confirmed in MessageSurface/MessageRows. Baseline completed from an immutable exact-main archive.
- Timestamp gap proved by an actual failing Postgres regression: assistant createdAt is assigned at finalization; activity reader retains provider duration but reads only task/interaction runtime times. A runtime start cannot currently be reconstructed after operational retention. Task4 added only prepare.createdAt response projection and server-owned checkpoint turn_started_at metadata; no migration, schema, provider protocol or canonical identity change.


## Implemented contract and review decisions

- AppModel owns one stateful assembler. Canonical path, imported history/fork divider, optimistic operations, actual prepare bindings, foreground and background runtime, and durable execution ledger become one row list. Surface performs one message ForEach; deleted independent pending/replacement/recovered runtime owners, hidden overlay, and typing indicator.
- Operation UUID owns optimistic user/assistant IDs. Prepared response binds real prepare/request/user IDs; canonical activity.prepareId binds the assistant backing. Existing canonical and recovered slots retain UI identity across later Retry. Edit/Retry truncate the current branch atomically. After a failed refresh, bound optimistic users and runtime bodies remain; older Retry with operation:nil still truncates by its actual parent.
- One body reconciles deltas, final text, and authoritative canonical content. Empty canonical backing retains the visible body. Rich UI children use logical text offsets across real durable text blocks and one direct render list, while original blocks, ranges, provenance and citation authority remain intact.
- Activity merges prior known evidence, durable ledger, foreground and background overlays by real entity IDs. Terminal state cannot downgrade from late Pending/Running. Final visibility filtering reapplies actual hidden/ambient task ancestry; it does not delete canonical evidence. Task root tool IDs do not double-count. AskUserQuestion durable identity/answer details remain unchanged.
- Pending displays Thinking… without a provisional timestamp. Client click time can drive provisional elapsed, but the first displayed timestamp comes from authoritative prepare/runtime lineage; it freezes through handoff and reload uses the checkpoint's same start. This avoids freezing a pre-network client timestamp that cannot be recovered durably. Only provider/checkpoint duration is authoritative; a late duration_ms can replace approximate elapsed, then remains fixed through background updates.
- Expansion/voice state belongs to stable row IDs; explicit user expansion/collapse survives projection changes. Copy targets only logical body, with feedback overlay. Retry requires a real parent and terminal phase. Error/interruption retain existing body/evidence; observation and refresh failures remain fail-soft.
- Geometry always updates near-bottom truth; follow intent changes through user scrolling or explicit Send/Return. Pagination records stable ID plus relative offset. Edit/Retry capture once per operation UUID and fall back to the actual replacement slot if downstream anchor was removed; user interaction cancels pending restoration. Menus/sheets/taps do not reset follow intent. Existing data wins over loading/unavailable, initial loading is quiet, and confirmed ready-empty alone displays empty state.
- Independent read-only review initially found four Important gaps (failed-refresh retention, multi-block rich identity, removed-anchor fallback, slow-prepare timestamps); all closed. Followup identified repeated anchor capture and stale older Retry after pending removal; both closed with RED→GREEN. Final hidden/ambient merge fix reviewed without an Important regression. Reviewer did not perform physical/device acceptance.
- Protected files untouched. A canonical identities, D trusted projection, E parser semantics, G sandbox, C downloader, provider/bridge normalization and database schema unchanged. F deferred; Mainline 3/C/G physical acceptance pending. No deployment, daemon restart, production DB mutation or merge performed.

## Verification ledger

Environment: Node 24.19.0; same dependencies and root test command/order for exact-main baseline and PR. Local Postgres 18 on disposable isolated DB only. Swift tests compile production Foundation models.

- RED→GREEN: initial lifecycle architecture; retained rich/source namespace; actual Postgres preparation start after operational retention; recovered older branch; fail-soft missing prepared user; multi-block rich identity; slow prepare timestamp; older Retry operation:nil; late hidden/ambient ancestry; failed Edit restores the original timestamp-only header without optimistic duration.
- Lifecycle: 144 actual Swift assertions, including every Edit/Retry prepare/partial/tool/input/result/canonical frame, stable rows/children, body, failure, background, duration, timestamp, expansion, scroll/anchor, initial/stale load and history/fork.
- A–G/#812/#813/#815/ordinary-hidden-ambient/current-path/history/background/attachment/settings focused: 92 tests, 91 pass, 1 known baseline failure (`real Swift Activity preserves final duration and explicitly presents nested permission`). Additional final lifecycle + unchanged historical tool ledger: 2/2 pass. E/B lifecycle focused: 6/6 pass.
- Isolated Postgres: 14/14 pass (turn repository/checkpoints/current path/branches/history/content/D/#812/#813/#815/ordinary-hidden-ambient), plus attachment concurrent migration/retention 1/1 pass. No skips.
- Production runtime gate: 405/405 root and 101/101 selected bridge tests. Complete bridge: 125/125.
- Root typecheck, generated freshness, build and base-relative diff check pass. Node24 Web typecheck/build pass. Final unsigned arm64 Simulator build pass.
- Full baseline: 2105 total, 2000 pass, 10 fail, 95 skip. Initial PR run: 2106 total, 2001 pass, 10 fail, 95 skip; added/removed failure names both empty. Final immutable implementation/test revision `45f68bc38636c76ee5af04c5155f4ff41fd92bd6`: 2106 total, 2001 pass, 10 fail, 95 skip; added failure names [], removed failure names []. The root suite itself reports 144 passing Swift frame assertions.

Baseline historical failure names (not incidentally fixed):
1. CI checks after a failed gate still run once their setup succeeds
2. CI reports all verification surfaces independently for PR and push
3. CI scopes database access to Postgres gates and preserves every verification command
4. authenticated Native Live internal JSON can exceed the public 1mb limit
5. iOS Runtime UI prefers SDK tool display names and surfaces API retry state
6. real Swift Activity preserves final duration and explicitly presents nested permission
7. tests/ios-native-live-message-surface-boundaries.test.ts
8. the app JSON parser accepts a 100k CJK Diary body
9. the app JSON parser remains bounded above 1mb
10. unauthenticated Native Live internal JSON does not get the larger parser budget

Full-suite comparison is complete. PR: https://github.com/nenecaramel/leilei-os/pull/839 (open, no merge). Commit/push/attach and hygiene:finish completed. Task-owned disposable worktree/dependencies/build/cache/logs and stopped isolated test Postgres will be removed at closeout; owner checkout, running owner daemon and unrelated worktrees are preserved.


## Review followup: terminal teardown and fresh recovery

- Backend prepare intentionally leaves the canonical current head unchanged. Active/prepare reads now expose the owner-scoped `preparedUserMessage` and exact `replacementTargetUserMessageId`, including the real parent/block provenance. Fresh clients hydrate that user without pending operations, identity bindings or retained rows. Canonical completion keeps the recovered user/assistant presentation IDs.
- Failure still writes no canonical assistant/checkpoint and advances no head. Its actual prepared user, request/prepare identity, operation, replacement lineage, start time, failure code, runtime events and interactions are atomically stored as `providerMetadata.native_live_failed_turn`. This is presentation evidence, not a sixth Chat product identity. It survives deletion of operational preparation/events and is returned by owner-scoped current-path reads as `failedTurn`.
- Foreground observation can clear its in-memory surface once current path owns matching failure evidence. Nil pending + nil runtime, refresh and fresh reopen all reconstruct the unique Failed row, preserving partial body and tool Activity; failed Retry never re-exposes its superseded answer. Retry remains actionable only for a real canonical current-path user, matching the existing backend eligibility contract.
- A new successful prepare atomically clears the old failure and writes `native_live_presentation_owner` with its prepare ID and unchanged head. Delayed older finalization cannot reclaim that ownership; a changed head prevents reanchoring. Idempotent failure replay cannot revive cleared evidence. Preparations created before this marker existed retain the existing compatibility fallback.
- Current-path pagination carries failure evidence independently of its canonical page. When an exact replacement target/parent is outside that page, the assembler discards unknown descendants instead of showing the old branch. Conditional refresh includes the failure identity in ETag; absent evidence preserves the old ETag format, and clearing it invalidates the cached failure.
- Ordinary execution remains Activity evidence. No canonical content/provider protocol, schema, E parser, G sandbox, C downloader, protected workflow/package files, production DB or owner daemon changes.
- RED evidence: real Postgres active read omitted detached prepared users; previous production Swift assembler lost a fresh failure at nil runtime/pending. GREEN: real Postgres prepare/failure/success fixtures drive production Swift recovery, teardown, reopen, non-root truncated paths, canonical handoff and retry-slot checks.
- Independent requesting-code-review review found the truncated-page descendant defect; fixed with a non-root fixture and re-reviewed with no remaining Important finding.

Followup verification ledger will be recorded after all gates and exact-main name comparison finish.
