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
| `NativeLiveBackendRelayRepository` owns durable dispatch and listener leases | Active user/listener lease admits reserve. `pending → reserved → executing → completed`; pre-execution expiry releases reservation back to pending. Expiry after execution becomes `delivery_unknown`, preserving owner/evidence for late submission rather than proving provider failure. | `native-live-backend-relay.integration.test.ts` (isolated DB opt-in) |
| `NativeLiveBackendRelayService` owns orchestration, not durable state | Result preparation ID must equal reservation ID; repository checks user/listener/reservation ownership before canonical finalize. Completion/rejection mutations must return applied/idempotent; stale mutations cannot emit a terminal wake. Canonical `FINALIZE_CONFLICT` gets a durable rejection receipt. Wake delivery is advisory and cannot undo durable state. | `native-live-backend-relay.test.ts` |
| `native-live-background-result-repository.ts` owns independent background receipts and the native continuation cursor | Prepare captures source/head/session/cwd/effective parent and server generation/revision. Submit locks source, receipt, conversation and live listener lease in a serializable transaction; stale branches discard result content, matching terminal retries return the original outcome without advancing again. No canonical/Mind finalization or execution authorization. | `native-live-background-result.integration.test.ts`: real row-lock barriers overlap head rotation, lease takeover and a competing receipt; authenticated HTTP path and duplicate delivery are also exercised. |
| `NativeLiveMacDaemonLoop` owns the active provider turn handle | Relay reserves work, execution-start is recorded before execution, and controls act through the active turn controller. Result delivery uncertainty is recorded rather than reexecuting provider work. | `native-live-mac-daemon-loop.test.ts`, `native-live-mac-http-relay-client.test.ts` |
| `tools/claude-code-mind/hook.mjs` owns local session receipt state | State is read/written under the session lock. Prompt submit rotates active turn and retires pending receipts; reset rotates epoch/context epoch. Stop captures epoch/active-turn/context-epoch and receipt identity under lock, performs HTTP outside the lock, then reacquires the lock and rechecks the fence before clearing its receipt. | `claude-code-mind-finalized.test.ts` |

Stop is a **weak receipt acknowledgement**, separate from iOS interrupt and
canonical turn completion. It proves neither completed generation nor memory use.
StopFailure clears pending; failed/lost acknowledgement retains the current receipt
for idempotent replay; a new prompt abandons that retry. Subagent events cannot
consume the main session's pending receipt.

## Deterministic verification boundaries

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
