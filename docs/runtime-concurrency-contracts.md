# Runtime concurrency contracts

This is a navigation map of current owners and fences, not a new runtime design.
The [domain map](../.agent/domain-map.json) defines verification gates and device
boundaries. Product and receipt semantics remain in
[Claude Code Mind](claude-code-mind.md) and the
[branch/session spec](superpowers/specs/2026-10-06-native-live-branch-session.md).

| State / owner | Transitions and stale-operation guard | Behavior coverage |
| --- | --- | --- |
| iOS `ChatView+MessageMutation.swift` owns local `pendingOperation`; `AppModel` in `NativeLiveTurnController.swift` owns `chatSendInFlight` | UI admits one pending operation; controller admits one send/retry/edit, captures conversation and canonical head before preparation, and releases its in-flight flag with `defer`. These are local admission gates, not durable reservation ownership. | `ios-chat-orchestration-smoke.test.ts`, `ios-chat-orchestration.test.ts` |
| iOS `ChatView+RuntimeControl.swift` owns control admission and pending mid-turn text | One control request at a time; interrupt requires an active visible turn and no existing nonfailed interrupt. Mid-turn text clears only after accepted lifecycle/receipt/attribution evidence and only if the current draft still matches. Ambiguous send/interrupt delivery has no blind retry. | `ios-composer-callback-equivalence.test.ts`; daemon control behavior in `native-live-mac-daemon-loop.test.ts` |
| iOS `NativeLiveRuntimeStore.swift` owns foreground/background observation tasks | Observation is keyed by preparation ID; cancellation and identity checks prevent applying pages to a different preparation. Conversation selection limits the visible surface. | `ios-chat-orchestration-smoke.test.ts` |
| SDK `AgentSdkTaskState` owns process-local task observations and stop attempts | Only SDK level snapshots replace live membership. Exact `run_id` edges enrich one run; opaque process-local handles fence stale controls, including legacy task-ID reappearance. One bounded stop attempt per appearance; timeout is unknown, never a successful stop. Process exit marks unfinished observed/live work unknown without replay. | `tools/claude-bridge/test/agent-sdk-task-state.test.mjs` controlled streams, deferred stop response, deterministic timeout |
| `NativeLiveBackendRelayRepository` owns durable dispatch and listener leases | Active user/listener lease admits reserve. `pending → reserved → executing → completed`; pre-execution expiry releases reservation back to pending. Expiry after execution becomes `delivery_unknown`, preserving owner/evidence for late submission rather than proving provider failure. | `native-live-backend-relay.integration.test.ts` (isolated DB opt-in) |
| `NativeLiveBackendRelayService` owns orchestration, not durable state | Result preparation ID must equal reservation ID; repository checks user/listener/reservation ownership before canonical finalize. Completion/rejection mutations must return applied/idempotent; stale mutations cannot emit a terminal wake. Canonical `FINALIZE_CONFLICT` gets a durable rejection receipt. Wake delivery is advisory and cannot undo durable state. | `native-live-backend-relay.test.ts` |
| `native-live-background-result-repository.ts` owns independent background receipts and the native continuation cursor | Prepare captures source/head/session/cwd/effective parent and server generation/revision. Submit locks source, receipt, conversation and live listener lease in a serializable transaction; stale branches discard result content, matching terminal retries return the original outcome without advancing again. No canonical/Mind finalization or execution authorization. | `native-live-background-result.integration.test.ts`: real row-lock barriers overlap head rotation, lease takeover and a competing receipt; authenticated HTTP path and duplicate delivery are also exercised. |
| `NativeLiveMacDaemonLoop` owns the active provider turn handle | Relay reserves work, execution-start is recorded before execution, and controls act through the active turn controller. Result delivery uncertainty is recorded rather than reexecuting provider work. | `native-live-mac-daemon-loop.test.ts`, `native-live-mac-http-relay-client.test.ts` |
| `NativeLiveSilenceWakeService` owns silence and [concern](native-live-concerns.md) wake receipts; `NativeLiveConcernService` owns concern rows | Fire recomputes the schedule, foreground block, receipt slot and due concerns in one serializable transaction; a duplicate fire finds the receipt and queues nothing. Concern edits/releases are `expected_revision`-fenced in the `UPDATE` predicate; program-owned wake counters never bump that revision. | `native-live-concern.integration.test.ts` (isolated DB opt-in): repeated fire, parallel same-revision updates, foreground block, Rewind, session switch, handoff, sleep catch-up |
| `tools/claude-code-mind/hook.mjs` owns local session receipt state | State is read/written under the session lock. Prompt submit rotates active turn and retires pending receipts; reset rotates epoch/context epoch. Stop captures epoch/active-turn/context-epoch and receipt identity under lock, performs HTTP outside the lock, then reacquires the lock and rechecks the fence before clearing its receipt. | `claude-code-mind-finalized.test.ts` |

Stop is a **weak receipt acknowledgement**, separate from iOS interrupt and
canonical turn completion. It proves neither completed generation nor memory use.
StopFailure clears pending; failed/lost acknowledgement retains the current receipt
for idempotent replay; a new prompt abandons that retry. Subagent events cannot
consume the main session's pending receipt.

## Deterministic verification boundaries

SDK turn completion retains a finishing turn until delivery settles; close or
failure rejects that turn and late delivery cannot reopen it. Advisory event
uploads share a two-second elapsed deadline across response parsing, retries and
batch splitting; terminal result submission keeps its separate budget.

The main dispatcher acquires one fresh listener lease before background receipt
replay, terminal recovery, and new reservation. It does not reacquire merely
because empty background recovery preceded dispatch. Recovery that consumes 30s
of the server's 60s listener lease requires renewal before proceeding; busy or
failed renewal leaves saved output intact and starts no fresh input. Independent
periodic recovery still acquires its own listener lease.

Automatic background receipt replay reacquires the listener lease before delivery.
Shutdown does not begin replay after a pending renewal returns. A handoff drain is
not ready while that conversation has normal or quarantined background receipts.
After a local acknowledgement partially succeeds, recovery still verifies writer
retirement before releasing its conversation fence.

An explicit HTTP 409 `RESERVATION_CONFLICT` for a foreground terminal receipt moves
its unchanged local evidence to quarantine. The affected conversation remains
fenced across restart; unrelated conversations can proceed. This is containment,
not proof that the old reply was committed. Verified recovery is still required
before reusing that conversation. Transport and other ambiguous failures retain
the ordinary retry record; neither path reruns Claude to reconstruct output.

Relay service tests use a deferred finalize barrier to force a repository mutation
conflict after ownership admission. They assert service sequencing and observable
calls; they do not prove SQL locking or simulate a real listener takeover. The DB
suite covers persisted owner/status predicates and reservation expiry separately.
Hook tests hold the HTTP confirmation response to force prompt/reset races and
assert the resulting state; no paint delay is required for these races.

The iOS orchestration/equivalence suites include source-selection/fixture checks;
they are useful regression evidence but do not establish device scheduling,
SwiftUI rendering, or live transport acceptance. No DB, model, daemon, installed
Hook, or device action is required to run the relay service tests.

## Native scheduled-work limits

A persistent writer permits at most 64 autonomous input attempts over seven days.
Denied or uncertain attempts also consume that existing budget. Limit errors name
the exhausted bound; ordinary chat and task list/delete/stop remain available.
Creating another schedule or sending an ordinary message does not reset it. To
continue scheduled work deliberately close and reopen the writer only after its
work and result receipts have settled and drained; do not abandon uncertain output
or automatically reset a writer to evade the limit.

## Background attachments

Background images and `send_file` share the foreground sender and one pending-
inclusive eight-item collector per exact native command/segment. SDK ownership
and router generation/source/session checks surround uploads. Sealing waits for
pending uploads; the existing result journal then preserves IDs and metadata
without uploading again on replay. Canonical publication binds completed owned
attachments in the existing receipt transaction, including attachment-only and
covered deferred messages. No separate storage or client message is introduced.

An upload already started by the file sender cannot be physically cancelled; an
aborted collector may leave an unreferenced upload but cannot attach it to another
segment. Ambiguous SDK results folding background attachments into foreground
consumption fail closed; text-only folding keeps its existing behavior. Live
acceptance must cover separate and interleaved native result boundaries.

## Inline transfer and test isolation

Inline PUT capabilities are authorized before binary buffering/decompression and
again at storage time, so expiry during upload still fails closed. Valid compressed
uploads and legacy inline downloads retain their existing behavior. This closes
an anonymous pre-authorization resource path; it is not an aggregate limit on
valid, authorized uploads.

Native-session CLI fixtures give child processes a disposable HOME rather than
consulting the owner's recovery directories. A synthetic pending receipt in the
parent HOME must not affect fixture outcomes; real recovery guards remain active.

HTML/SVG inline delivery was evaluated separately. Current MIME support alone
does not demonstrate an owner-token or cross-user bypass, so this change does not
alter download disposition or introduce a separate rendering policy.

## Local automatic Wake switch

From the canonical Mac checkout:

```sh
cd ~/Developer/leilei-os-main
pnpm wake on
pnpm wake off
pnpm wake status
```

This persistent local switch controls only the post-reply 5–10 minute and
last-user-message 90–120 minute silence opportunities, and the
[concern](native-live-concerns.md) wakes that share them. It does not change
normal chat, Cron/Monitor/Bash jobs, Mind recall, or Railway configuration.
The commands need no credentials. Default is ON; the private marker is
`~/.leileios/wake/disabled`. Status reports the local switch; a backend
`NATIVE_LIVE_SILENCE_WAKE_ENABLED=false` still overrides local ON.

The daemon version containing this feature must be loaded once. Thereafter
filesystem notifications interrupt its current idle wait immediately; no
restart, deployment, or new polling loop is required for toggles. Failure
to inspect/watch the control disables automatic silence wake and leaves
normal chat available. A failed OS watcher stays disabled for that daemon
lifetime rather than continuously recreating watchers; repair filesystem
access and restart the daemon after such an exceptional failure. The switch is checked again before firing. It does
not cancel requests already sent or force-stop running tasks.

OFF leaves existing server epochs/receipts intact. ON resumes the current
schedule, so an unconsumed opportunity already due can run immediately;
new user activity still replaces that schedule. Shutdown retains priority
over switch notifications, and watchers are closed after each idle wait.
