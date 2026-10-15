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

### Stage 2C: per-conversation process ownership

Ruling: add an explicit new-session registry before daemon activation. A working-directory transport pool cannot own simultaneous long-lived conversations: one cached transport would cause unrelated chats in the same directory to share admission and process controls. The registry creates a distinct configured transport per conversation, canonicalizes cwd through the existing validator, rejects duplicate/cached runtime ownership, and bounds pending/live/failed-close slots without idle eviction or task replay.

Local generation tokens revoke callbacks on retirement and prevent stale closes from affecting replacement sessions. They are NOT canonical epochs, head checkpoints or relay leases. Input authorization is rechecked after awaits; background sinks must still implement their own durable transaction fence. New opens reject while a conversation is retiring; failed close retains capacity and a metadata-only generation lookup allows targeted cleanup retry. Shutdown revokes all entries synchronously, forbids new opens and waits for attempted launches/closures. Explicit `closePersistentSession` supports retry after a failed SDK startup close, without reaching into transport internals.

Stage 2 remains incomplete: no daemon caller or normal wake behavior changes in this step. Actual restore identity/checkpoint admission, normalized streaming, attachment ownership, durable result/background finalization and quiet-tail updates remain required before switching wake to the persistent path. No real model, production DB, deployment, installed hook or daemon changes. Tests exercise same-directory independent sessions through the actual transport factory with an injected SDK boundary, plus deferred retirement/admission/startup and failure cleanup races.

Review ruling: retiring a still-loading transport immediately cancels its startup claim, not merely its eventual input callbacks; a deferred real-factory SDK-loading test reproduced a late query launch before this fix. Final independent review reports no blockers and independently passes all 13 registry behavior tests.

### Stage 2D: durable reservation admission for the future turn adapter

Ruling: before connecting the persistent registry to the daemon, add an authenticated identity-only execution-admission snapshot. `ownsSubmitReservation` deliberately permits late results from delivery-unknown/completed reservations; it must never authorize further SDK execution. New read-only SQL jointly checks user/listener ownership, actual executing state, live listener and reservation deadlines, canonical presentation/head, exact stored request/session/checkpoint identity, current parent checkpoint/cwd, and wake source-user epoch/latest-user/head. Foreground preparations revoke old wake admission. No prompt or credential enters the request or response; only a boolean is returned. An older server/repository or malformed/failed response denies rather than falling back to result-submission ownership.

Mac admission has a single two-second request bound, no retry/cache, explicit input IDs and human/task-notification source checks, no idle tool authorization, and exact existing-session identity for resume. The registry still owns local revocation checks around asynchronous callbacks. A snapshot grants no durable capability: canonical finalization must retain its transactional fences, and a future per-turn adapter must select the current reservation rather than keep a prior turn's callback forever.

This is a required server/Mac protocol path, not daemon activation. Current dispatch and normal wake remain unchanged; unsupported fork/edit/retry paths cannot use this new gate. Existing reservation deadlines are intentionally not extended by a read. Long-running background execution will require explicit safe renewal/reservation lifecycle work before rollout; this PR does not silently grant an expired reservation more time. Native restore/checkpoint and quiet-tail integration, normalized streaming/attachments and autonomous result finalization remain outstanding. Real PostgreSQL tests use a freshly initialized, attested loopback-only PostgreSQL 18 test cluster; no production DB or model is involved.

### Stage 2E: exact native persistent restore and Desktop ownership fence

Ruling: add a separate `restorePersistentSession` entry point; keep `openPersistentSession` explicitly new-only. Restore requires the original local session, durable checkpoint, first input UUID and human/task-notification source. Materializing remote SessionStores are rejected. Original-session startup verification is extracted from the existing interactive turn handle and reused: verified SessionStart receipt or init gates initial delivery, and init is still required before tools or assistant execution. Every later message retains the same SID. Startup has a bounded deadline; cancellation, missing/copied identity and failed-close ownership have behavior coverage.

Native history is re-read after SDK loading AND after the final asynchronous authorization, using the existing canonical checkpoint/tail validator. An ancestry cache alone is not fresh proof. The registry exposes `openExisting`, reserves native SID ownership before startup, prevents a second conversation in the same registry from opening that writer, observes later identities, and retains failed-close ownership until explicit cleanup succeeds. A public typed factory test drives two resumed turns through one injected SDK query.

Desktop integration ruling: admission must reject `nativeSessionSource.owner=desktop` (and unknown owners), while missing legacy owner remains compatible. This prevents a new persistent execution permission while Desktop owns the conversation. It is not a completed handoff drain or an OS-level atomic writer lease. Before releasing to Desktop, the future daemon adapter must fence queued wakes/new inputs, settle or stop in-flight tasks, flush durable outcomes, close the SDK query and verify it stopped writing. Report completed/stopped/unknown truthfully; lack of an acknowledgement never means stopped. Late results must remain on their original branch, never the new Rewind head. Preserve the existing append-only wake projection; separate wake presentation must not rewrite synchronized history.

No default daemon caller or wake-fork switch is added here. Per-turn reservation/callback replacement, normalized stream/image/file ownership, quiet-tail checkpoint updates, long-running renewal and autonomous result finalization remain activation gates. Full live handoff/wake/rewind/device acceptance is pending and requires separate authorization for a formal daemon refresh. Controlled SDK tests are not real model/CLI acceptance.

Review ruling: a verified startup receipt does not override a concurrent abort. Return-time lifecycle admission is rechecked after startup readiness; a deterministic receipt-then-abort generator reproduced the closed-host success bug before the fix. Final independent review passes 45/45 host/restore tests with no remaining blockers.

Verification wiring: register the execution-admission DB suite in the existing isolated-Postgres runner so CI can execute these guards when available; this is a declaration change, separate from the 21 real DB tests actually run here.

### Stage 2F: per-reservation persistent turn routing

Ruling: introduce an explicit Mac turn router over the real registry and execution-admission callback. One router owns one conversation generation. Each send/wake uses its own immutable parsed command, input UUID/source, current reservation authorization, question/permission handlers and durable result sink. A foreground result does not release the reservation slot until its sink reports applied/idempotent together with the exact provider checkpoint persisted by that commit. Tools are denied while acknowledging or idle. Concurrent calls reject rather than queue a stale preparation.

Autonomous frames go only to the required generation-scoped background sink, with no current foreground command. Foreground and background acknowledgements are serialized; each successful commit updates the tracked checkpoint before the next sink starts. Subsequent resume commands must match that checkpoint, including a fresh check around input authorization after background advancement. The adapter never guesses a quiet native checkpoint. These sinks still require existing transactional canonical/reservation fences; local generations and execution snapshots do not prove a commit. Rejected/unknown foreground finalization retires and closes the writer without replay. Retirement revokes callbacks before awaits; a result whose sink committed during retirement cannot be reported as current success. Duplicate opens cannot claim and close a different router's existing generation.

Persistent tool callbacks now retain the invoking host turn object across all asynchronous authorization/permission boundaries. A late callback cannot approve a tool against a newer turn merely because the provider session ID is unchanged. Controlled-stream regressions reproduced all three authorization, permission and PreToolUse races before the fix.

Activation boundaries: this adapter is not selected by the daemon yet. It rejects fork/edit/retry, attachment capabilities, failed-input receipt reconciliation and in-place execution-selection changes rather than silently losing existing behavior. It returns correlated result frames, not normalized live streaming. Session-control UI, stream/image/file normalization, execution readback, quiet native checkpoint tracking, durable autonomous preparations/lease renewal and the complete Desktop handoff drain remain required. Closing the writer alone does not prove that an already-started backend sink has settled. No production/model/device acceptance or daemon refresh is performed here.


Stage 2F review rulings: an earlier version validated only the live session ID and could silently ignore a different requested checkpoint. The acknowledgement contract now carries the committed checkpoint; mismatched or missing checkpoints fail closed. The reviewer also reproduced retirement between an inner authorization check and its caller's continuation. Synchronous outer lifecycle/turn checks now guard both handler invocation and final approval. Both findings were captured by failing controlled-stream tests before the fixes.

Full-suite baseline ruling: unrelated iOS source-contract assertions are not repaired in this runtime PR. Run those same files at the exact origin/main baseline and report their actual failures separately; no weakening of assertions or UI changes is authorized here.

### Stage 2G: per-turn live output (stream, tool images, send_file)

Ruling: live output belongs to a turn only after the SDK stamps that turn's input UUID (`user_message_uuid(s)`) on a top-level reply frame: the first non-ping stream event and the first assistant message, and again after a fold. Until then, output in the segment is background. The host normalizes each result segment once, streams only owned events to that turn's `onNormalizedEvent`, and returns exactly those events as `normalizedEvents`. Background frames carry their own `normalizedEvents`. If a result assigns an unstamped frame to the turn (older producer), the whole frame is returned without early streaming; nothing is guessed.

Tool-result images are forwarded only for owned frames, using the owning turn's handler, and are aborted when the turn ends. The session has one `send_file` MCP server; each call goes to the owning turn's handler and is refused for background work or between turns. The router passes these handlers per reservation, guarded so they act only while that reservation is executing. `output_attachments_enabled` is now supported. Input attachments, failed-input reconciliation, execution readback and the other activation gates are still refused or pending.

### Stage 2H: durable checkpoint for each persistent frame

Ruling: the router never commits a checkpoint it has not seen on disk. For each foreground or background frame, the transport takes the last top-level assistant record (not a subagent record), waits a bounded time (3 s) for the live CLI to write it, then requires it to be present in the durable transcript prefix and to descend from the previously committed checkpoint. A missing record is refused (`NO_PROVIDER_SESSION`), and so is a record on another branch (`PROVIDER_SESSION_CONFLICT`). The sink receives that `providerCheckpointId`, and its acknowledgement must name exactly that checkpoint. Failure retires the writer without replay.

Known strictness: a frame with no top-level assistant record (no output) fails closed, including in the background. Relax it only with evidence from a real CLI.

### Stage 2I: persistent executor (commit inside the turn)

Ruling: the router's sink must be the real submission, because the writer may advance only after its checkpoint is committed. `NativeLiveMacPersistentExecutor` keeps one router per conversation. It routes only send/wake commands that a new writer or the current writer can continue (`router.matches`: same session, committed checkpoint and execution selection). Fork, edit, retry and other checkpoints are not routed; the caller retires the writer first and uses the legacy path. It materializes attachments into the prompt, cleans them up, and caps tool images plus send_file at 8 per turn, as the legacy executor does. It builds the success result from the verified checkpoint and submits it through the caller's `commit` inside the router's acknowledgement.

Delivery states for the daemon:
- `committed`: submitted inside the turn; never resubmit.
- `unknown`: the commit response was lost; mark delivery unknown.
- `pending`: nothing was submitted; submit the failure result as usual.

Only `completed`/`idempotent` advance the writer. Wake outcomes (`wake_quiet`, `wake_stale`, `wake_discarded`) currently retire it.

Server gap found (next): a quiet or background turn in a persistent session advances the native tail without a visible canonical message, and the next command's parent checkpoint must follow that tail. Until the server records a native tail checkpoint (and a durable background preparation/finalization endpoint exists), quiet wakes and background results retire the writer. Wakes are still dispatched as forks, so they do not route here yet.

### Stage 2J: invisible same-session quiet-wake resume cursor

Ruling: preserve the immutable canonical provider checkpoint for explicit branch operations, and store a separate native continuation cursor in that checkpoint's existing JSON runtime metadata. No table/column/migration is required. The cursor is bound to canonical message, original checkpoint, session, cwd, presentation generation and native-source revision. Normal send and silence-wake preparation resolve it; replacement/fork checkpoint reads retain the original branch point. Authenticated execution admission accepts a wake only at the current resolved cursor, never its obsolete canonical base. Foreground preparations retain their already-captured parent across presentation-owner rotation under the existing exact reservation/head/lease fences.

A quiet resume result uses the existing authenticated result submission route and a serializable repository transaction. The transaction locks preparation and conversation, verifies current head/latest-user epoch, captured generation/revision, original binding/cwd, expected prior cursor and absence of active foreground work. It writes the cursor and consumes the wake atomically. It creates no visible assistant message, performs no Mind write and does not mutate the canonical checkpoint. A stale quiet result is consumed without advancing the cursor. Old preparations lacking generation evidence fail closed. Legacy fork quiet discard remains unchanged.

Only a newly committed quiet continuation returns `nativeResumeCheckpointId` through the existing internal HTTP result receipt; deleted-wake duplicate submissions retain existing terminal/discard semantics and never rewrite the cursor. This is not a new historical replay mechanism or a durable autonomous background receipt. The #1095 executor still retires on quiet outcomes; accepting this new acknowledgement through the Mac protocol, dedicated autonomous result preparation/submission, lease renewal, compact/handoff integration and daemon activation remain later slices. No default wake dispatch switch, daemon refresh, deployment or production DB operation occurs here.

Review ruling: accepting either base or cursor for a wake would allow two queued wake slots to run from an obsolete native head. The real-PostgreSQL regression first reproduced that admission, then passed after restricting wake admission to the exact effective cursor. Preparation generation/revision snapshots also prevent a late quiet result from adopting a rotated owner on the same visible head. Final static independent re-review found no remaining actionable blocker; reviewer did not independently rerun tests.


### Stage 2K: durable independent background result receipts

Ruling: prepare and submit autonomous results through new authenticated internal routes, bound to the last completed visible preparation and its current canonical head, provider session, effective parent cursor, cwd, presentation owner and native-source revision. Reuse runtime-event storage and its source FK/retention; no table, migration, visible user/assistant turn or canonical/Mind finalization is added. New foreground commits stamp server-owned generation evidence on the canonical checkpoint; historical checkpoints without that evidence fail closed. A client generation UUID identifies a receipt, not a durable execution grant or OS writer lease.

Preparation expires after ten minutes. Submission locks source, receipt, conversation and live listener lease in a serializable transaction, rechecks the snapshot, and atomically updates only the native continuation cursor plus the independent terminal receipt. Two receipts from one parent cannot both advance. A stale result retains only its fixed outcome and normalized hash, discarding its body. A matching terminal retry returns the original acknowledgement even after later head/lease changes; a different result under the same receipt conflicts. This retry does not rerun a task. Receipts disappear with their source/ordinary retention; this is not historical replay after purging.

Bounds: protocol 4 only, 2 MiB result, 1,024 normalized events, exact session/cwd/source identity, no attachment IDs, metadata or attachment events until background attachment ownership is implemented. Existing event normalization is reused without changing ordinary streaming behavior. Transactions have five-second statement and two-second lock bounds, with at most one retry for serialization/deadlock/unique-key races. No network or model waits occur inside the transaction.

Tests use a disposable, attested loopback PostgreSQL 18 cluster. Actual row-lock barriers exercise overlapping lease takeover, head rotation and competing receipt submission; no fixed delay establishes the overlap. The attachment-event acceptance gap was first reproduced by a negative test and then closed. HTTP tests exercise real authentication middleware contracts and the complete request/service/repository path with synthetic data.

Activation remains deferred: no daemon/SDK caller selects these routes, no background execution or renewal permission is granted, and quiet acknowledgement consumption, lifecycle/task ownership, Desktop drain and live acceptance remain subsequent work. No model call, production DB operation, deployment, hook change or daemon restart occurs in this slice.
