# Claude Code handoff — native runtime reliability

## Resume checkpoint (supersedes historical next steps below)

The user asked Codex to continue after this handoff was first written.
`e598e57b` replaces the obsolete whole-snapshot source regexes with actual Swift
unchanged-poll write-count assertions; the actual Swift harness plus original
turn lifecycle file passed all four tests. `f7981f65` safely merges origin/main
`fa98819e`, including #1177–#1179, without conflicts. Both are pushed.

Final verification on this integrated source is running in these logs:
`/tmp/leileios-reliability-merged-full.log`, `-merged-typecheck.log`,
`-merged-build.log`, `-merged-gate.log`, `-merged-xcode.log`, `-merged-db.log`.
Full Node24 ordinary suite and Node22 production gate must be counted only from
their completed summaries. The DB run includes all nine relevant files, including
#1179 concerns and silence wake tests; it uses only the explicit local test DB.
The PostgreSQL task cluster has been restarted for this validation. No PR, merge,
deployment or daemon refresh has happened for this feature branch yet.

## Start here

Continue existing work; do not reimplement from scratch. User requested four repairs plus associated behavior coverage: Wake backoff, persistent edit/retry, authentication refresh investigation, and delivery latency. Work is NOT complete, merged, deployed or loaded in the daemon.

- Repository: nenecaramel/leilei-os.
- Canonical checkout: `/Users/Admin1/Developer/leilei-os-main`, main, clean when handed off. Do not modify local signing or user changes.
- Working checkout: `/tmp/leileios-runtime-reliability-20261020` (physical `/private/tmp/...`).
- Branch: `fix/native-runtime-reliability-20261020`.
- Original base: `1f34a33b46bee50b720eb4caaeeff450f95cb27d` (#1176).
- While work ran, origin/main advanced four commits to `fa98819e` (#1177, #1178, #1179). Fetch and inspect these changes before integration. #1179 adds concerns/wake behavior: preserve it and test compatibility. Do not reset either checkout.
- No PR exists for this branch yet. The outgoing agent will commit/push this handoff and implementation together.

## Implemented

1. `native-live-backend-relay.ts`: busy Wake rejection formerly wrote pending + nonnull reservation expiry, violating the strict DB constraint. Pending lease fields now stay null; reserveNext uses the existing error code/updated timestamp for three-second backoff. Repeated rejection is idempotent and cannot slide the deadline. No migration.
2. Replacement execution: real protocol parser, server execution admission/lease and Mac callback admission now support exact-checkpoint edit/retry new/fork. Retire/settle old writer before opening persistent child. Child callbacks pin child identity rather than parent identity. Unsupported checkpoint-less legacy forks remain one-shot. An exact replacement denied persistent capacity fails rather than silently falling back to one-shot.
3. Continuation-derived child tasks: taskSource can prove a finalized child from its server-written checkpoint generation and current well-formed handoff revision, while retaining owner/listener/nearest-session/path-floor/pending-replacement fences. Handoff source itself is not rewritten. At the handoff anchor, fork admission cannot borrow an old canonical checkpoint if the authoritative handoff cursor changed.
4. Delivery: sparse runtime events start upload within 100ms, keeping single ordered uploader and clearing timers. iOS refresh publishes events before secondary interaction/control requests and merges into latest matching state. Control creation preserves newer event/cursor state and newer same-ID control snapshots. The final tiny optimization avoids writing identical event state on unchanged polls.
5. `scripts/run-isolated-postgres-regressions.mjs` includes the new replacement DB test. No new production architecture, schema or credential logic.

## Authentication and transport — unresolved boundaries

Actual SDK `auth status` read-only check returned loggedIn=true, authMethod=claude.ai. It does not prove refresh will always work. Original refresh failure response/cause was not present in available evidence. #1175 already fixes known zero-token synthetic auth-error history recovery; do not claim the refresh root cause fixed or automatically replay messages. Do not read/print credential contents, add homemade refresh-token management or change subscription/API authentication.

`connection: close` was introduced by commit `3899cf6327a7e3fb8594389870d600426e249b3e` to avoid stale relay keep-alive sockets. It remains unchanged. Do not remove it solely based on noisy health-probe timings. Serial network admission overhead remains; the current patch fixes proven buffering/UI delays, not all end-to-end latency.

## Actual validation results

Node 22 path: `/opt/homebrew/opt/node@22/bin`; pnpm 11.9.0.
Node 24 path: `/Users/Admin1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`.
Use `pnpm_config_verify_deps_before_run=false` with shared dependency links. Root node_modules and tools/claude-bridge/node_modules are symlinks to canonical dependencies; do not commit them. Web dependencies were installed within this temporary checkout using Node 24 npm ci.

- Wake real DB RED: 0 pass / 1 fail on base, strict pending constraint violation. Fixed relay/Wake tests: 4 pass.
- Replacement real preparation/parser/admission RED: 0 pass / 4 fail; initial GREEN 4 pass. Expanded six cases edit/retry × new/fork/continuation include real Mac HTTP → server parser → actual DB admission and renewal, coordinator finalization, task admission and revocation. Latest six-case HTTP run: 6 pass / 0 fail.
- New child-ID Mac admission tests: RED 4 pass / 4 fail, GREEN 8 pass.
- Replacement route RED: 0 pass / 5 fail; fixed. Capacity failure test separately RED then GREEN.
- Actual registry + transport with controlled SDK wire: edit/retry fork, background publication and subsequent send retain one child process: 2 pass.
- **Real pinned CLI offline Cron test:** `RUN_NATIVE_CLI_OFFLINE_EDIT_CRON_TEST=1 node --test tools/claude-bridge/test/agent-sdk-native-edit-cron-offline.test.mjs`: 1 pass, about55sec. All model responses were from a loopback fixture; no real account/model calls. This proves the transport layer, not live iPhone acceptance.
- Sparse timer test: mock clock RED then GREEN.
- Actual Swift production-method harness: RED then GREEN for eager event publication, stale preparation rejection, observation retirement, delayed control creation and newer same-ID control preservation. Latest final tiny poll optimization: 1 pass.
- Targeted 8 files: 201 pass / 0 fail / 0 skip (`/tmp/leileios-reliability-target-final.log`).
- Real isolated DB 7-file regression: 90 pass / 0 fail / 0 skip (`/tmp/leileios-reliability-db-final.log`); later six-case HTTP additions separately passed.
- Real continuation DB: 27 pass / 0 fail / 0 skip (`/tmp/leileios-reliability-continuation.log`).
- Full bridge: 623 pass / 0 fail / 8 opt-in skips (`/tmp/leileios-reliability-bridge-final.log`).
- Node22 typecheck PASS, including new HTTP DB fixture (`/tmp/leileios-reliability-typecheck-http.log`).
- Node22 build PASS. Production runtime gate: 710 root +401 bridge PASS, no skips/failures (`/tmp/leileios-reliability-gate-verified.log`).
- Xcode simulator Debug unsigned build PASS (`/tmp/leileios-reliability-xcode-final.log`), BEFORE the final tiny unchanged-poll optimization; rerun on final HEAD. DerivedData `/tmp/leileios-runtime-xcode-20261020`.
- db:check initially refused missing DATABASE_URL (no implicit environment used); rerun against explicit local test URL passed.
- **Complete Node24 suite is NOT GREEN:** 3226 total, 2919 pass /1 fail /306 skip. Failure: `composer typing is isolated from unrelated chat churn`, `tests/ios-native-live-turn-lifecycle.test.ts:120/124`, expecting old `guard changed,...` whole-snapshot writeback. Inspect its intent and replace stale source-pattern assumptions with meaningful assertions alongside the new actual Swift behavior test. Do not delete/weaken the protection. This run started before the final control-race/tiny-poll changes, so rerun final suite after resolving this.

## Independent review

- Wake reviewer: no blocker; reviewed timestamp writers, idempotence, pending constraints and ownership.
- Replacement reviewer found capacity fallback and continuation-child task denial. Both were reproduced/fixed; re-review found no blocker (139 targeted pass). Optional missing/malformed revision and changed cwd cases were subsequently added and passed in the six-case real DB test.
- Delivery reviewer found stale whole-surface control writeback and same-ID pending regression. Both reproduced/fixed in actual Swift harness; final re-review found no remaining blocker.
- Review does not substitute for final tests, latest-main integration or live acceptance.

## Isolated database and task artifacts

PostgreSQL18 task-only cluster `/tmp/leileios-runtime-pg-20261020`, bound127.0.0.1:55474, username runtime_test, trust auth, no production credentials. DBs `leileios_runtime_test` and `leileios_native_session_test`. Every new DB test verifies loopback + actual server/database target with the repository helper. No production database accessed. The outgoing agent stops this task cluster at handoff; restart only with:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /tmp/leileios-runtime-pg-20261020 -l /tmp/leileios-runtime-pg-20261020/server.log -o '-h 127.0.0.1 -p 55474 -k /tmp' start
```

Explicit DATABASE_URL for tests only: `postgresql://runtime_test@127.0.0.1:55474/leileios_runtime_test`. Continuation test requires same server with database `leileios_native_session_test` and `RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST=1`. Do not inherit an existing DATABASE_URL.

## Remaining work, in order

1. Read AGENTS.md/domain map and inspect current branch. Fetch main; integrate latest main safely in the temporary branch, preserving #1179 concerns/wake changes. Do not touch canonical dirty files or reset history.
2. Resolve the full-suite obsolete source-pattern failure by preserving actual intent. Rerun actual Swift harness, appropriate iOS behavior tests and final Xcode build. Add focused tests for any latest-main conflict resolution.
3. Repeat changed concurrency/Wake/HTTP DB tests for flakiness. Run final Node22 targeted/typecheck/build/runtime gate, full bridge and complete Node24 suite; record actual counts/failures/skips. No real Claude calls or private content.
4. Keep authentication refresh root cause explicitly unresolved unless new evidence proves it. Do not call this entire reliability project fully finished.
5. Produce PR with actual scope/results and known limits. Standing user authorization normally allows verified normal merge, but do not merge failed tests or bypass protected checks. GitHub CI billing prevents execution: report it, not PASS.
6. Confirm automatic Railway deployment SHA/readiness separately from merge. No manual production DB operation/migration/config change. This branch requires no migration.
7. Refresh local daemon only if user still wants activation and it is idle/no active SDK work; do not kill Desktop processes. No automatic replay. iOS changes require user Xcode/device update and user-initiated acceptance.
8. Run hygiene, remove only task-created worktree/dependencies/DerivedData/logs/cluster after preserved work is delivered. Do not delete canonical dependencies, user data, credentials, backups or unrelated PostgreSQL services. Existing system PostgreSQL pid837 is unrelated; never stop it.
