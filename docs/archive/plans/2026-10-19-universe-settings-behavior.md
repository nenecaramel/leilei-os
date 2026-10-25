# Universe and Settings behavior follow-up

Goal: finish the three concrete UI test gaps recorded in #1170 without redesigning pages or duplicating lifecycle owners.

- [x] Merge the already reviewed/tested #1170 at its exact head and isolate this work from canonical main.
- [x] Mount actual Universe page/service/adapter: loading/retry, replaced API reads, edit/cancel, failed save, 409 and explicit retry.
- [x] Compile actual Universe node coordination and models: save single-flight, draft retention, cancel/discard, create position and close behavior.
- [x] Compile actual Settings actions and error mapping with held responses; reproduce stale preview, wrong loading ownership, duplicate export/restore and stale fingerprint retry before fixes.
- [x] Fix demonstrated defects: node/mode-based draft seeding; block 409 saves until latest detail is reopened; synchronous file-selection generation; exact preview fences; method-entry single-flight and stale preview invalidation.
- [x] Complete full suite, targeted repeats, root/Web checks and iOS Simulator build; review the final patch and report any unavailable review separately.
- [ ] Create and merge an independent PR if validation is satisfactory under the owner's authorization; verify automatic deployments, sync main, clean task-created worktree/build artifacts.

Constraints: no model calls, production DB operations, Hook install, daemon restart, signing edits, UI redesign, schema/dependency changes or changes to CI billing. Native task harnesses do not prove SwiftUI interaction on a device.
