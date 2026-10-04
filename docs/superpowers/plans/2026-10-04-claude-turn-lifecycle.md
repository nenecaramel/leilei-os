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
- [ ] RED real Swift per-frame Send/Edit/Retry/recovery/body mismatch tests, including first pending frame and canonical-before-runtime order.
- [ ] Move pending operation into Foundation; add runtime client lineage fields from prepare/active response.
- [ ] Implement row/turn presentations, actual lineage coordinator, deterministic assembler, retained last backing and activity overlay by stable child identities.
- [ ] Add unified phase/header/duration/timestamp selection; inspect durable timestamp gap and record minimum remedy if necessary.
- [ ] GREEN compiled Swift intermediate-frame regressions; commit.

### Task2: UI state and scroll models
- [ ] RED expansion/voice/copy state, scroll geometry/follow/event neutrality, exact viewport anchor and loading/stale snapshot fixtures.
- [ ] Implement per-stable-ID UI state and geometry/follow state; memory bounded/reset at logout, preserve manual intent.
- [ ] GREEN deterministic actual model tests; commit.

### Task3: AppModel / fixed SwiftUI rows
- [ ] RED removed-multi-owner integration and rich namespace regressions.
- [ ] AppModel owns pending/assembler reconciliation; prepare callback binds real lineage before observation. Recovery/background share the same assembly.
- [ ] Simplify MessageSurface to ForEach assembled rows; fixed user/assistant views consume presentation and state bindings only.
- [ ] Remove replacement hidden overlay/runtime-owner paths/typing row; Activity view only consumes unified projection/header and external expansion state.
- [ ] Preserve copy/edit/retry/sheets/Mind/Album/C media and stable rich children through backing handoff.
- [ ] Integrate atomic viewport anchor and persistent follow semantics; preserve stale snapshots/initial loading.
- [ ] GREEN model/integration compatibility and unsigned Simulator; commit.

### Task4: Durable timestamp if required
- [ ] Prove from real prepare/finalization/read paths whether start time survives retention; RED live/reload/retention test.
- [ ] Add only needed authoritative start-time metadata/response projection without schema/provider changes if evidence requires it.
- [ ] GREEN isolated Postgres retention integration and client timestamp tests; commit or record no extension needed.

### Task5: Full validation / review / PR
- [ ] A–G focused, voice/question/duration/ordinary-hidden-ambient Activity, current path/edit/retry/background/history/fork/attachment; relevant isolated PG.
- [ ] Runtime gate, complete bridge, typecheck/generated/build/Web gates/diff/unsigned Simulator.
- [ ] Fresh independent review; Important fixes RED→GREEN and relevant gates rerun.
- [ ] Sequential exact-main baseline vs PR full suite; report totals and added/removed failure names.
- [ ] Open `refactor: unify Claude turn lifecycle rendering`, exact SHAs and all requested contract/acceptance evidence, no merge.
- [ ] Commit/push/attach; hygiene and task-only temporary cleanup, stop for review.

## Evidence / rulings
- User supplied the full architectural spec and authorized implementation/PR. Execute in this session without repeating design approvals; preserve the supplied spec verbatim.
- Existing multi-owner paths and hidden overlay confirmed in MessageSurface/MessageRows. Baseline is running from immutable main archive.
- Timestamp gap under investigation: assistant createdAt is assigned at finalization; activity reader retains provider duration but reads only task/interaction runtime times. A runtime start cannot currently be reconstructed after operational retention. Task4 will prove and address this narrowly.
