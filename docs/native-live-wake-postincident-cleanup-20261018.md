# Native Live Wake/Cron post-incident cleanup (2026-10-18)

## Live acceptance already observed
The October 17 Wake/Cron recovery incident ended with the original historical receipt returning HTTP 200 for both `background-results/prepare` and `/result`, followed by a successful new Mac Agent SDK foreground turn. This confirms that the original delivery and foreground path recovered. Those two HTTP responses alone are **not** proof that every other old receipt has been recovered.

## Removed in this cleanup
- The temporary production-only `native_background_recovery_evidence` SQL query with its many per-predicate booleans.
- The `native_background_snapshot_missing` diagnostic, renewal-hash/renewal-snapshot rejection logs and fresh-snapshot rejection log.
- These observations were introduced to diagnose the October 17-18 HTTP 409 loop, are no longer required for admission, and performed additional work on failures. The actual HTTP conflict semantics are unchanged.

## Do not retire as dead code
- `NativeLiveMacWakeBrokerClient` and `native-live-work-wake.ts`: broker-based work notification and API waiters still serve live requests. PostgreSQL LISTEN/NOTIFY also supports control, interaction, and turn-terminal waits; it is **not** an unused duplicate of the external tiny broker.
- `NativeLiveSilenceWakeService` and the Mac silence scheduler: scheduled idle Wake is a live feature, distinct from the native Claude Cron result.
- `reconcileRejectedWakePresentationOwner`, `reconcileLegacyVisibleWakeAnchor`, exact receipt replay, and monotonic checkpoint/ancestry checks: narrowly fenced historic-result recovery. Removing them just after restoring one old session could reintroduce the original 409 for another surviving receipt.
- The no-broker relay wait path, the legacy failure-executor fallback, and the Mac outbox: active compatibility/transport safeguards. Their retirement needs a separately verified support cutoff, not this incident cleanup.

## Regression and deferred-retirement gate
Run root typecheck and build, Mac wake-broker/lease/background-result/persistent-router tests, HTTP relay/Wake tests, production runtime gate, and an **isolated** PostgreSQL suite for direct and multi-hop Wake receipts. Negative cases must still reject a rotated generation, unrelated branch, mismatched listener, runtime evidence, and an active foreground.

Do not point integration tests at the production database. No data deletion, automatic migration, daemon restart, Cron recreation, synthetic Claude result, or forced writer unfencing belongs in cleanup.

The historical compatibility code may be considered for later removal **only after** an authoritative database/outbox inventory proves that no eligible historical Wake or Cron receipt still needs it and the supported upgrade window has elapsed. Until then, delete the one-off diagnostics, not the recovery protocol.
