# Native continuation first-send binding

## Observed failure and scope

The production 2026-10-19 16:19:50 UTC first-send request reached execution
admission (HTTP 200) but `/input-binding` returned HTTP 409. The daemon then
reported `RUNTIME_UNAVAILABLE` with zero model events. The attached continuation
had a null canonical head and a native checkpoint. This is supported by the
continuation contract: old Desktop messages are not imported into the UI.

The binding repository nevertheless required a canonical message checkpoint.
An isolated PostgreSQL regression reproduced a null binding after successful
preparation/admission. An existing test also caught the same source-selection
inconsistency on current main: after a later Desktop handoff, prepare selected
the older canonical checkpoint instead of the new native checkpoint.

The fix recognizes the validated handoff cursor at its exact canonical anchor.
A canonical quiet tail can supersede it only when its base checkpoint, session
and working directory match that handoff. All existing reservation, listener,
presentation-owner, revision, parent and started-input fences remain in force.
No history is imported, no synthetic messages are inserted, and no schema,
Mac daemon, Hook, UI or model settings change.

## Local execution

Worktree: disposable `/tmp/leileios-continuation-bind-20261020`.
Node 22.23.3 for server/gates; Node 24.19.0 for the complete ordinary suite.
Database: task-created PostgreSQL 18 cluster, bound to `127.0.0.1:55473`, database
`leileios_native_session_test`. `current_database()`, `inet_server_addr()` and
`inet_server_port()` were checked before migrations. No inherited production
database URL, production database access, or model execution was used.

Commands (database commands use the explicit local URL above):

```sh
RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST=1 pnpm exec tsx --test tests/native-session-continuation.integration.test.ts
RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST=1 RUN_NATIVE_LIVE_RELAY_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/native-session-continuation.integration.test.ts tests/native-live-execution-admission.integration.test.ts tests/native-live-background-result.integration.test.ts
RUN_NATIVE_SESSION_PRESERVATION_DATABASE_TEST=1 RUN_NATIVE_SESSION_PICKER_DATABASE_TEST=1 RUN_ROLLBACK_PRESERVATION_DATABASE_TEST=1 pnpm exec tsx --test --test-concurrency=1 tests/native-session-continuation.integration.test.ts tests/native-session-preservation.integration.test.ts tests/native-session-picker.integration.test.ts tests/native-session-rollback-preservation.integration.test.ts
pnpm exec tsx --test tests/native-live-input-binding-contract.test.ts tests/native-live-mac-http-relay-client.test.ts tests/native-live-mac-persistent-turn-router.test.ts
pnpm typecheck
pnpm build
pnpm test:production-runtime-gate
pnpm test
```

- RED: extended first-send test failed with null binding; continuation suite
  7 passed / 2 failed. Unmodified main: 8 passed / 1 failed, the existing
  later-handoff checkpoint assertion. The added failure was specific to binding.
- Core database regressions: 91 passed / 0 failed / 0 skipped, three rounds.
- Continuation/preservation/picker/rollback database tests: 36 passed / 0 failed
  / 0 skipped. An earlier run without the picker/rollback opt-ins was 34 passed
  / 2 skipped; it is superseded by the fully enabled run.
- Input binding/Mac relay/router tests: 108 passed / 0 failed / 0 skipped.
- Typecheck and build: passed.
- Production runtime gate: 701 + 385 passed, no failures or skips.
- Complete ordinary suite on Node 24: 2,906 passed / 0 failed / 300 skipped
  (3,206 total). Two added database-only cases are skipped in the ordinary
  suite and executed in the explicit PostgreSQL runs above.
- The first broad attempt lacked the bridge/Web dependencies in the temporary
  worktree. Its module-resolution failures are setup failures, not passing
  evidence (first ordinary run: 2,771 passed / 15 failed / 299 skipped; first
  gate: 618 passed / 44 failed / 39 cancelled). Both clean reruns passed after
  dependencies were made available.
- Independent read-only code review found no concrete blockers; the reviewer
  did not rerun tests or invoke a live model.

## Separate existing failure

Adding `tests/native-live-persistent-wake.integration.test.ts` to the database run
gave 90 passed / 1 failed. The exact same test failed on unmodified main against
the same local database. `rejectReservation()` leaves a retry timestamp while
clearing the reservation owner, violating
`native_live_turn_preparations_dispatch_reservation_consistency`.
This independent wake-requeue issue is not changed by the first-send fix.

## Acceptance boundary

Local tests use synthetic inputs only. They prove the repository transition,
including first queued/started binding, idempotent binding, reply finalization,
next-send preparation, new handoff precedence and valid quiet-tail continuation.
They also reject source/session/checkpoint/directory/anchor/owner changes and
expired/replaced listener leases. They do not claim a live Claude reply has
been generated. Production application and a user-sent first reply remain
separate acceptance steps.
