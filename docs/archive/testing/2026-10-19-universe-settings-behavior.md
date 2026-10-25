# Universe / Settings behavior follow-up

This follows #1170. It closes the remaining page/action coverage gaps without redesigning UI or introducing another state owner.

## Changes proved by behavior tests

- Web Universe: failed saves retain the editor draft. An editing session retains its opening version; reconciliation cannot lend a newer version to stale full-field writes, including a lost response or cancel/reopen before the recovery read finishes. A conflict requires cancel/reopen and an explicit decision against the latest detail. Same-node detail metadata reads the current canonical node.
- iOS Settings: file-selection generation is established synchronously before launching preview work; obsolete responses cannot replace preview/error/loading state. Restore captures the selected file and fingerprint, rejects duplicate entry, and blocks file reselection while running. A stale fingerprint invalidates the preview. Export also rejects duplicate entry.
- iOS Universe: existing save/cancel/discard coordination passed new executable tests; no production change was required.

No schema, API, dependency, Hook, daemon, signing, layout or production-data changes.

## Evidence boundaries

The Web tests mount the actual page/router/service/adapter and papers with controlled synthetic API responses. Swift tests compile and execute the actual production coordination/actions and models in actor-matched storage harnesses, with held continuations. They do not mount SwiftUI or operate the system file picker. No real export/restore, model call or production DB operation was performed.

RED → GREEN evidence: the mounted page initially lost drafts on both network failure and 409; retaining drafts exposed unsafe fresh-version retries. Tests now cover remote changes to an unedited field and reopening before reconciliation completes. A same-node metadata refresh regression fails with the old metadata expressions. Settings initially failed stale-preview/operation-lifecycle scenarios before the guards were added. An old source-only Save-button assertion was updated to require the added conflict guard; its other requirements remain intact.

The first complete run reported 2,880 pass / 1 fail / 297 skip: the single failure was that source-only assertion, not an unrelated baseline failure. Final rerun: 2,883 pass / 0 fail / 297 skip, 3,180 total; the #1170 baseline was 2,866 pass / 0 fail / 297 skip, so this adds 17 passing cases.

## Verification

Commands run from the disposable worktree (Node 22 for root/runtime, Node 24 for Web and the complete ordinary suite):

| Command | Result |
| --- | --- |
| `pnpm test` | 2,883 pass, 0 fail, 297 opt-in skips (3,180 total) |
| `node --import tsx --import ./tests/register-css-loader.mjs --test tests/universe-page-behavior.test.ts tests/universe-paper-interaction.integration.test.ts tests/ios-universe-node-lifecycle.test.ts tests/ios-settings-task-lifecycle.test.ts` with `TSX_TSCONFIG_PATH=web/tsconfig.app.json` | 28 pass, 0 fail, 0 skip, three consecutive rounds |
| `pnpm test:production-runtime-gate` | 701 + 385 pass, 0 fail, 0 skip |
| `pnpm --dir tools/claude-bridge test` | 607 pass, 0 fail, 8 opt-in skips |
| `pnpm typecheck` / `pnpm build` | PASS |
| `cd web && npm run typecheck && npm run build` | PASS |
| `xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /private/tmp/leileios-ui-behavior-xcode-20261019 CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO build` | BUILD SUCCEEDED |
| `pnpm agent:verify --plan` / `git diff --check` | PASS; bridge scope comes from the temporary dependency symlink, not a bridge source change |

The complete suite includes the standard iOS contracts, agent/workflow and hygiene regressions. DB/device/model opt-ins were not enabled; these UI changes do not change database or server behavior. Logs are local under `/private/tmp/leileios-ui-behavior-*` and `/private/tmp/leileios-universe-*`.

## Review / acceptance

Independent final review found no remaining blocker after the version-baseline and detail-metadata fixes; the reviewer independently ran 28 Web/Swift behavior cases successfully. Xcode Simulator build succeeded with code signing disabled. Native device/file-picker acceptance and authenticated production interaction remain separate from compilation and harness evidence. GitHub CI billing is unchanged; unexecuted CI must not be described as passing.
