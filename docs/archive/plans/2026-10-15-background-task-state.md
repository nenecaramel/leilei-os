# Background task state implementation plan

**Goal:** Stage 3A of the approved six-stage lifecycle plan: trustworthy task identities, observable session-local state and fenced stop requests, before remote/UI controls.

**Architecture:** The persistent SDK host owns a task ledger for its process lifetime. Only `background_tasks_changed` owns live membership; task edges enrich matching runs. Immutable opaque handles fence controls across task-ID reuse. No model input, polling, file-output reading or new database storage.

**Tech Stack:** Node 22, pinned Claude Agent SDK 0.3.296.

**Spec:** User-approved stage 3 outline and `2026-10-15-claude-session-lifecycle.md` stages 1–2L. This slice does not finish stage 3 or declare per-task UI support.

## Constraints
- Preserve idle authorization denial and default `perTaskStopAffordance=false`.
- Keep existing `stopTask(id)` usable by handoff drain; expose an optional exact handle for future external callers.
- Never interpret a stop RPC response as authoritative task completion.
- No arbitrary output-file reads or private SDK request calls. Pinned SDK exposes stopTask but no public task-output reader.
- Protect canonical checkout; temporary worktree only; no model, production mutation or daemon restart.

## Review focus
- Late notifications for reused task IDs must not overwrite a newer run.
- Stop response/timeout racing a new run must not stop or report success for that new run.
- A foreground result must leave live background membership observable.
- Process exit/close must report uncertainty rather than invented successful task completion.
- Unbounded task progress/history and mutable SDK objects must not consume unbounded memory or let a caller retarget a control.

## Tasks
### Task 1: Session-local task ledger and stop fencing
- [x] Add controlled-stream host tests: idle state visibility, run reuse and same-ID reappearance without run_id, absent snapshot vs terminal status, close/crash unknown, bounded history, defensive copies, duplicate stop and stale stop response.
- [x] Run new tests RED against main.
- [x] Implement `agent-sdk-task-state.mjs`; integrate into host and typed session interface. Keep authoritative raw task set for compatibility.
- [x] Run host tests GREEN; run complete bridge tests and root typecheck/build/runtime gate.

### Task 2: Preserve run identity in existing presentation events
- [x] Add behavioral normalizer regression for run_id/parent_task_id on active_set and run_id on task edges.
- [x] RED, implement, GREEN; no UI redesign or capability switch.
- [x] Document scope, supported/public SDK boundary, restart limitation and remaining stage-3 integration.
- [x] Whole-branch independent review, gates and normal PR closeout.
