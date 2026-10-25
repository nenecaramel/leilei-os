# Settings native presentation follow-up

Baseline: #1171 merge `9c5109cd4b24a366c9c53670d4858a8678995f19`.

Only test/fixture/documentation files change. No production source, API, schema, signing, dependency, Hook or daemon changes.

## What executes

The explicit opt-in test builds a disposable copy of the actual iOS project, replaces its app entry with an isolated Settings host and synthetic data service, and appends a same-file probe to SettingsRestoreContent. The production SwiftUI body, @State, fileImporter closure and task methods remain intact; only the probe task is added to that disposable compilation copy. The main checkout and installed app are never changed.

On a newly created iOS 27 / iPhone 17 Pro simulator and unique test bundle:
- Actually presents UIDocumentPickerViewController; drives its native cancellation callback and dismissal. No preview or restore is admitted.
- Presents it again; drives the selection delegate with a synthetic JSON URL, then observes the actual fileImporter callback establishing selected URL, preview loading and restore eligibility.
- Runs replacement-preview and restore operations against the installed SwiftUI State, verifies exact file/fingerprint, blocks duplicate restore and file changes, invalidates a stale preview and rejects retry without a new preview.

Only the initial cancel/selection passes through the system picker delegate. Later reselection and restore calls are probe-driven production methods. This is not a touchscreen/end-to-end file browser test and does not establish iCloud or real security-scoped access on a device. No account, real backup, production network or database is used. Data-service continuations never execute a real restore.

## Actual validation

- Node 22.23.3 / Xcode iOS Simulator build with code signing disabled: PASS. Hosted test: **1 pass, 0 fail, 0 skip**, repeated successfully (two positive runs).
- Negative control in the disposable source only: replace the synchronous prepareRestorePreview call in the real fileImporter closure with the current generation. Hosted test fails at `real fileImporter callback to service` (expected); restore the unchanged callback and repeat: PASS. This proves the native callback wiring is required for the first preview, rather than bypassed by the probe.
- `pnpm typecheck`: PASS.
- `node --import tsx --test tests/ios-settings-task-lifecycle.test.ts tests/ios-universe-node-lifecycle.test.ts tests/ios-settings-export-restore-v4.test.ts tests/ios-native-live-current-path-idle.test.ts tests/ios-chat-selection-persistence.test.ts tests/ios-settings-hosted-acceptance.test.ts`: **24 pass, 0 fail, 1 opt-in skip** without the simulator variable. The skip is the new hosted test, explicitly run above.
- Independent read-only review: no blocker; reviewer did not rerun the simulator test.
- Initial fixture setup had an incorrect enum argument label and omitted the picker dismissal that native UI performs alongside the delegate callback. These harness errors were corrected before claiming the positive result; they are not product RED evidence.

Run explicitly on a disposable booted simulator:

```sh
SETTINGS_HOSTED_SIMULATOR=<simulator-uuid> \
node --import tsx --test tests/ios-settings-hosted-acceptance.test.ts
```

Default temporary app sources/builds are removed, and the test bundle uninstalled in finally. SETTINGS_HOSTED_CACHE explicitly retains the caller-selected cache; all task-created caches and the task-created simulator are removed at closeout. SETTINGS_HOSTED_NEGATIVE=1 is only an explicit negative-control mode and must fail the test.

The complete ordinary suite/runtime gate were not repeated for this tests-only follow-up. Their #1171 results remain historical evidence, not new runs. The new hosted test is intentionally skipped in ordinary CI without a disposable simulator. No manual deployment or device install is required by this test-only change; no claim of authenticated production/device acceptance is made.
