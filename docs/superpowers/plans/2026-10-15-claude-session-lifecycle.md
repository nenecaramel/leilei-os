# Claude same-session lifecycle implementation plan

**Tech Stack:** Node 22, pnpm 11.9.0, Claude Agent SDK 0.3.296.

**Spec:** User-approved six-stage outline; architecture and constraints below define stage 1.

**Goal:** Normal wake continues the current Claude session; foreground turns can finish while background work remains observable and stoppable.

**Architecture:** A Mac-owned session host keeps one SDK query/input stream alive and separates turn completion from session closure. Backend preparations continue to own canonical writes and fencing; SDK events arriving without an active preparation require separate session/background routing. Resume restores conversation state, not dead processes. Explicit fork/rewind remains a branch operation.

**Constraints:** Node 22; existing canonical checkout untouched; disposable /tmp worktrees. No live model calls, production changes, daemon restart or automatic merge. Do not conflate synthetic SDK streams with real CLI behavior. Existing hook, memory and permission behavior must remain intact.

## Stages
1. Offline lifecycle host and behavior probes (this PR). Unconnected to production. One query/two turns, idle task events, stop vs close, queue races, session isolation, late task notifications and exit failure. SDK input is injected; actual CLI/model capability acceptance remains pending.
2. Integrate host with Mac daemon and backend wake. Remove forced wake-fork contract only with head/epoch/checkpoint/lease validation; per-turn event routing and durable finalization. Expose real per-task stop UI before declaring its SDK capability.
3. Background Bash/Agent/Monitor ownership, results and task controls; explicit restart limitations and recovery policies.
4. Loop/Cron/ScheduleWakeup/goal; persist triggers and deduplicate execution, expiry, cancellation and budgets.
5. Remaining output surfaces and official integrations (audio/files/long output/MCP Apps/Artifacts/Chrome/cloud routines); assess official background supervisor integration separately.
6. Full fault/device acceptance and old-path retirement. Desktop control and push are excluded.

## Stage 1 tasks
- [x] Add failing controlled-stream tests for multi-turn persistent session behavior.
- [x] Add an inactive session host using injected SDK query and public input/control interfaces. Do not change the existing turn transport.
- [x] Test interruption without closure, task stop without deleting state prematurely, stale task run notifications, concurrent inputs, wrong-session messages and process exit without replay.
- [x] Run complete bridge tests, root typecheck/build/runtime gate; request independent review.
- [ ] Publish independent PR with precise offline limitations; remove temporary worktree.

## Acceptance distinction
Passing host tests proves our queue/event/ownership implementation against a controlled SDK interface. It does not prove the real CLI keeps every Monitor/Cron alive, resumes subprocesses after a crash, or integrates the official supervisor. Those must be verified explicitly before activation. No six-stage completion claim is permitted after stage 1.

## Stage-2 hard gates identified by the prototype

### Stage 2A: safe same-session wake contract (first prerequisite)

Existing discard logic assumes every wake owns a fork and schedules its result session for deletion. Before any live same-session integration, discard must only retire a distinct fork child; quiet/stale resume must preserve the source session. Protocol v4 accepts checkpoint-addressed resume wake while retaining exact session-result matching, no fabricated canonical user message and existing checkpoint validation. This prerequisite does not change wake creation: it still dispatches forks until session-host integration and capability rollout are ready. Old daemon compatibility is therefore unchanged.

Behavior and isolated PostgreSQL regressions cover quiet/stale resume, a fork unexpectedly returning its own source ID, and normal distinct-child cleanup. The database is local test-only. Further stage-2 work must also track the native tail/checkpoint of quiet same-session turns without inventing visible user messages; reopening from the old canonical checkpoint must not rewind away completed background activity.

- Require reliable consumed-input UUID echo. Unsupported or missing correlation needs a bounded failure policy; the inactive prototype otherwise leaves the submitted input pending.
- Verify native resume identity before permitted execution, preserving existing startup-hook/checkpoint safeguards. Initial-prompt ordering in a controlled stream is not that proof.
- Route autonomous and folded turns through durable backend preparations. Never charge a background result to an unrelated user request.
- Handle interrupt receipts for still-queued input separately from executing work; never blindly replay a failed process's submissions.
- Provide actual per-task stop controls before declaring the SDK capability.

Independent review exposed incorrect result attribution and startup ordering. Result/input UUID joins, separate autonomous result frames, and first input triggering initialization are now tested. Real CLI/model acceptance remains pending.

### Stage 2B: explicit persistent transport entry point

Ruling: connect the host to the actual configured transport through `openPersistentSession` for NEW sessions only; do not activate it in the daemon yet. Existing-session restore still requires the pre-execution native identity/checkpoint protocol, so unsupported resume/fork options reject instead of silently creating or branching a session. Stage 2 remains incomplete until the daemon/canonical adapter is connected.

The entry point requires an `authorize` callback and an awaited `onBackgroundResult` sink. Admission runs before each submitted input and at PreToolUse/permission callbacks; the consumer must implement real head/epoch/checkpoint/lease checks rather than returning true in production. Human and task-notification sources are explicit; unspecified input is unclassified, never assumed human. SDK default permissions, real question answers, setting sources, environment, MCP configuration and execution selection are preserved. Per-task stop capability defaults false and must not be declared true until the consumer has real controls.

Transport admission is held during SDK loading, legacy turn execution, live sessions and failed closes. Abort prevents late startup or late admitted input. A successful close releases ownership; failed close can be retried without starting another process. Missing/zeroed SDK result correlation fails the host explicitly; distinct autonomous results reach the mandatory sink, and newly submitted work waits for that sink's acknowledgement before admission.

Before activation, the daemon adapter still must provide durable turn reservations/finalization and normalized streaming events, track native quiet-tail checkpoints, preserve image/file callback ownership and execution readback, reconcile queued-input interrupt receipts, and manage separate session identities rather than treating the cwd pool as a session registry. Native restore/startup safeguards and capability rollout remain required. No model call, migration, daemon restart, hook change, production switch or default wake behavior change is part of this prerequisite.

Review rulings: lifecycle admission is checked before/after authorization and after asynchronous permission/question answers. Canceled startup retains ownership until its actual query closes; failed close retains a retryable host. Background acknowledgement generations invalidate input admission even when the acknowledgement completes during the admission await. Deferred-response behavior tests cover each ordering; none uses real models.
