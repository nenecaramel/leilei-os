# Native runtime reliability

## Scope

This patch repairs Wake deferral, enables exact-checkpoint edit/retry to own a
persistent child, and removes proven streaming/UI buffering delays. It reuses
existing admission, leases, registry, result outbox and checkpoint generation
owners. No production schema, authentication credential manager, new scheduler,
history import or automatic execution replay is introduced.

The branch integrates main `fa98819e`, including #1179 concern wakes. Its database
migration belongs to main, not this patch. Concern scheduling remains intact.

## Repairs and invariants

- Pending Wake rows keep reservation/start fields null as required by the
  database constraint. An existing rejection code and updated timestamp enforce
  the three-second retry delay without extending it on polling/idempotent reject.
- Edit/retry retires and settles the old writer before opening a persistent
  new/fork child. The protocol, actual database admission and lease checks now
  support these operations together. Parent checkpoint/cwd, presentation owner,
  visible head and live listener remain mandatory. Child callbacks pin the child
  session rather than inheriting the parent session ID.
- Exact replacements denied persistent capacity fail instead of silently
  becoming one-shot. Historical checkpoint-less forks retain the legacy fallback.
- Finalized continuation-derived children prove task authority using their exact
  server-written checkpoint generation and current well-formed handoff revision.
  Existing owner, visible ancestry floor, nearest durable session and live
  listener checks remain. Source revision rotation revokes child task admission.
  A changed authoritative handoff cursor cannot borrow an old canonical cursor.
- Sparse deltas start upload within 100ms; only one ordered upload drains protocol
  batches. Terminal boundaries still await delivery, and timers are removed.
- iOS publishes received events before waiting for interaction/control reads.
  Unchanged polls do not rewrite observable state. Secondary replies merge into
  the latest matching preparation; control creation cannot restore old events or
  regress a newer same-ID control snapshot.

## Remaining boundaries

The original SDK OAuth refresh failure is **not diagnosed or claimed fixed**.
Read-only SDK auth status currently reports a valid claude.ai login. #1175 already
handles known zero-token SDK auth-error history after reauthorization. No token
contents were read/printed and no automatic message replay was added.

Relay `connection: close` stays: commit `3899cf63` introduced it to avoid stale
keep-alive sockets. Serial admission network round trips and long-context model
latency remain; no live end-to-end speed improvement is claimed from unit tests.

Old branch tasks intentionally stop on edit/retry; only tasks on the surviving
new child can continue. Device acceptance and a real user-initiated turn remain
separate from local verification. No real account/model call was used for tests.

## Verification

Server/Mac commands used Node22.23.3; the complete ordinary suite used Node24.19.0
with temporary Web npm dependencies. Shared dependency links are not committed.

| Check | Actual result |
| --- | --- |
| Wake DB baseline | 0 PASS /1 FAIL: strict pending constraint violation |
| Initial replacement real preparation/parser/DB | RED 0/4; GREEN 4/0 |
| Child callback admission | RED 4 PASS /4 FAIL; GREEN 8 PASS |
| Replacement route | RED 0 PASS /5 FAIL; GREEN after implementation |
| Sparse flush and actual Swift races | Reproduced RED before repair, GREEN after |
| Relevant targeted regression | 201 PASS /0 FAIL /0 SKIP |
| Repeated Mac/Swift concurrency regressions | 199 PASS per run, two runs, no failures/skips |
| Isolated database regression, integrated main | 99 PASS /0 FAIL /0 SKIP |
| Exact replacement Mac HTTP → parser → DB → finalization → task admission | Six new/fork/continuation edit/retry cases PASS, included in DB total |
| Native continuation isolated DB | 27 PASS /0 FAIL /0 SKIP |
| Full Claude bridge | 623 PASS /0 FAIL /8 existing opt-in SKIP |
| Real pinned CLI fork/Cron/later chat/idle trigger with loopback model fixture | 1 PASS, no external model requests |
| Node22 typecheck/build | PASS |
| Production runtime gate on integrated main | 724 root +401 bridge PASS; no failures/skips |
| Xcode simulator Debug, code signing disabled only for command | BUILD SUCCEEDED |
| db:check against explicit local test DB | PASS |

Final complete ordinary suite on integrated main: **3246 total, 2934 PASS,
0 FAIL, 312 SKIP**, 208549ms. Existing opt-in skips remain explicit, not passes.
Additional mapped iOS/tooling gates: 30 PASS. Final changes after the simulator
build were test/documentation-only; production sources match the successful build.
Git diff and hygiene checks passed. PR/activation status is recorded separately.

Commands (Node versions selected via PATH):

```sh
pnpm typecheck
pnpm build
pnpm test:production-runtime-gate
pnpm --dir tools/claude-bridge test
pnpm test
pnpm exec tsx --test tests/ios-runtime-delivery-latency.test.ts tests/ios-native-live-turn-lifecycle.test.ts tests/ios-message-process-sections.test.ts
RUN_NATIVE_CLI_OFFLINE_EDIT_CRON_TEST=1 node --test tools/claude-bridge/test/agent-sdk-native-edit-cron-offline.test.mjs
```

Database regression uses explicit localhost `127.0.0.1:55474`, databases
`leileios_runtime_test` and `leileios_native_session_test`, in a task-created
PostgreSQL18 cluster. Tests attest actual host/port/database through the safety
helper. Never inherit a production DATABASE_URL. The nine-file run used:

```sh
RUN_NATIVE_LIVE_RELAY_DATABASE_TEST=1 RUN_NATIVE_LIVE_TURN_DATABASE_TEST=1 \
pnpm exec tsx --test --test-concurrency=1 \
  tests/native-live-replacement-admission.integration.test.ts \
  tests/native-live-task-controls.integration.test.ts \
  tests/native-live-execution-admission.integration.test.ts \
  tests/native-live-persistent-wake.integration.test.ts \
  tests/native-live-backend-relay.integration.test.ts \
  tests/native-live-backend-turn-repository.integration.test.ts \
  tests/native-live-background-result.integration.test.ts \
  tests/native-live-silence-wake.integration.test.ts \
  tests/native-live-concern.integration.test.ts
```

## Baseline and review

After integration, latest main itself reproduced two silence Wake DB test
failures and one Thought process source-pattern failure in the same environment.
Tests now use the current exact wake marker, persistent listener capability and
same-session result identity. The older staged-work fixture explicitly orders its
timestamps, and checks exact `wake_stale` plus committed native cursor. The sheet
test requires the medium/large detents already approved in #1177. No production
behavior was changed to accommodate these tests.

The old runtime whole-snapshot source regex was replaced by actual Swift method
execution proving no writes on unchanged polls, identity fencing and delayed
response state preservation. Existing keyboard/composer checks remain.

Independent reviews found and required fixes for capacity fallback, continuation
child task admission, stale control writeback and same-ID control regression.
Re-reviews found no remaining blockers, including #1179 scheduling integration and
the baseline test corrections. GitHub billing failures are never counted as CI
passes. Live acceptance is not claimed by these local results.
