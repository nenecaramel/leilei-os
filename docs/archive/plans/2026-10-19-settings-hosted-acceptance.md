# Settings hosted acceptance implementation plan

**Goal:** Close the remaining native presentation gap from #1171 using an isolated simulator and synthetic data.

**Architecture:** Follow the existing opt-in hosted ChatView test pattern. Build a disposable app copy with the actual SettingsRestoreContent SwiftUI body and State, replace only its app entry/data service, and add same-file probes in that copy. No production hook, test mode or runtime owner is added.

**Tech stack:** Node 22, Xcode, SwiftUI, iOS Simulator.

## Steps
- [x] Add a hosted opt-in test and fixture: actual native importer presentation/cancel, synthetic delegate selection, preview loading/reselection, restore single-flight/stale preview, file lock.
- [x] Run on a dedicated newly created simulator. Include a negative control against the actual UI file-selection callback fence.
- [x] Run related Swift lifecycle/contract tests, typecheck and hygiene; review changes and report evidence boundaries.
- [ ] Create and merge the tests-only PR under existing authorization if validated. Verify automatic release skip, clean the temporary app/worktree/simulator.

## Constraints / review focus
No account, production network, DB, real backup, signing changes, daemon restart or Hook update. The system picker delegate is driven with synthetic URLs: this tests SwiftUI presentation/callback wiring, not a human browsing iCloud or device security-scoped file access. Preserve all source in canonical main; test instrumentation exists only in disposable compilation copies. Simulator tests remain explicit opt-ins.
