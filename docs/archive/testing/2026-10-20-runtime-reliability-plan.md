# Native runtime reliability implementation plan

**Goal:** Repair the verified Wake retry defect, complete replacement execution safety, investigate authentication recovery and reduce proven delivery latency.

**Architecture:** Reuse existing dispatch, persistent session, admission and result outbox owners. No parallel scheduler, history reconstruction or automatic replay. Each independently testable fix gets its own commit and review.

**Constraints:** Node 22 for server/Mac; Node 24 for Web. Disposable worktree only. No production DB access or migrations, no credential output, no real model calls for tests. Preserve exact checkpoint, presentation owner, session and listener fences. Unknown delivery is not failure and must not trigger execution replay.

## 1. Wake retry

- [x] Reproduce current main in a verified localhost PostgreSQL 18 test database.
- [x] Test pending lease invariants, immediate deferral, later eligibility and duplicate reservation.
- [x] Keep pending lease fields null; use existing rejection code/updated timestamp for the three-second scheduling backoff.
- [ ] Run relay/database regressions, typecheck/build and runtime gate; review and ship separately.

## 2. Edit/retry persistent execution

- [ ] Trace actual preparation, parent checkpoint, authorization, child session identity and finalization contracts before changing guards.
- [ ] Add failing end-to-end protocol/database tests for new/fork edit/retry, stale owner/head/listener, old background completion and ambiguous commit.
- [ ] Reuse registry fork/new support only after matching admission/lease and child-session authorization are proven; retire old writer before opening replacement.
- [ ] Verify same-turn background retention and subsequent send continuity without model calls.

## 3. Authentication

- [ ] Separate SDK subscription auth from LeileiOS MCP OAuth and relay authorization.
- [ ] Identify refresh failure evidence without reading tokens; if unavailable, state the unknown cause explicitly.
- [ ] Add only justified failure classification/recovery guidance; never auto-replay messages or claim third-party refresh guarantees.

## 4. Delivery latency

- [ ] Test sparse event flush with a controlled clock and deferred network boundary.
- [ ] Trace connection-close rationale before any transport change.
- [ ] Test event presentation independently of slow interaction/control reads; preserve preparation identity and cancellation fences.
- [ ] Run applicable Swift behavior checks/Xcode build for iOS changes.

## Review focus

- Repeated rejection must not extend backoff indefinitely or duplicate dispatch.
- Replacement closes must settle before the new writer starts; unknown close stays fenced.
- Child session tool authorization must not accidentally inherit parent session authority.
- Failed/ambiguous submissions must retain outbox custody and avoid execution replay.
- Slow secondary UI reads must not overwrite newer controls or another preparation's events.

## Closeout

- [ ] Record actual RED/GREEN, targeted/database/full suite/gate/type/build counts and all skips/failures.
- [ ] Independently review before normal merge; CI billing failures are not passes.
- [ ] Refresh an idle local daemon only after merge; verify automatic deployment separately from merge.
- [ ] Clean only task-created worktree/database/artifacts.
