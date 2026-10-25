# Chat Surface Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the iOS Native Live chat message surface into focused source files while preserving all current product behavior and authority semantics.

**Architecture:** Keep `Chat/NativeLiveMessageSurface.swift` as the stable composition/root entry point and extract rendering responsibilities into `Chat/MessageSurface/`. The extraction is intentionally presentation-only: no API, model, Runtime, canonical, attachment-transfer, or turn-lifecycle semantics change.

**Tech Stack:** SwiftUI, UIKit context menus, QuickLook, CryptoKit, existing LeileiOS iOS module, Node/tsx source-contract tests, Xcode.

**Spec:** `docs/superpowers/specs/2026-10-02-repository-maintainability-refactor-design.md`

## Global Constraints

- Zero intentional product behavior change.
- Do not change API routes or request/response contracts.
- Do not change database schema, migrations, canonical Conversation semantics, Runtime authority, provider-session semantics, Workspace semantics, Send/Retry/Edit behavior, or attachment transfer/validation behavior.
- Keep `Chat/NativeLiveMessageSurface.swift` as the stable root/facade for this phase.
- Do not import code from draft PR #793. It remains reference material for Mainline 2.
- New Swift files are discovered by the existing Xcode file-system-synchronized project structure; do not edit the project file unless Xcode proves that assumption false.
- Any functional bug discovered during extraction is recorded for a separate PR, not fixed here.
- Each extraction should move existing implementation with the smallest access-control change required for cross-file compilation.
- GitHub-hosted Actions are currently quota-blocked; verification for this phase is local/self-hosted and must not treat missing hosted runners as code evidence.

## Review Focus

1. **Swift access control after extraction:** types formerly `private` must be visible only as broadly as needed inside the app module; the Xcode build must catch unresolved/inaccessible symbols.
2. **UIKit context-menu lifecycle:** moving `UIViewRepresentable`/Coordinator must preserve copy/edit menu actions and preview shape; final device smoke checks both actions.
3. **Quick Look attachment preview cleanup:** moving attachment preview code must preserve temporary-file creation, SHA/size verification, and cleanup on dismiss; final device smoke opens and dismisses a real attachment.
4. **Runtime interaction submission:** moving Permission/AskUserQuestion views must preserve pending-state rendering and the exact `onResolve` response path; source contract plus Xcode build pin the callback signatures.
5. **Pending/streaming replacement composition:** moving message/runtime rows must not change when optimistic/pending/recovered runtime rows appear; existing current-path/older-pagination tests plus final Xcode build guard the root composition.

---

### Task 1: Establish structural guard and extract Markdown/timestamp utilities

**Files:**
- Create: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/ChatMarkdown.swift`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/MessageTimestampFormatter.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift:1-2572`

**Interfaces:**
- Consumes: existing `ChatMarkdownView(text:fillsAvailableWidth:lineSpacing:paragraphSpacing:)`; existing `MessageTimestampFormatter.string(from:timeZoneIdentifier:)`.
- Produces: the same internal Swift symbols at the same signatures, now defined in focused files; later tasks continue to call them without wrappers.

- [ ] **Step 1: Write the failing structural test**

Add tests that assert:
- `Chat/MessageSurface/ChatMarkdown.swift` exists and contains `struct ChatMarkdownView`, `enum ChatMarkdownBlock`, and `enum ChatMarkdownParser`.
- `Chat/MessageSurface/MessageTimestampFormatter.swift` exists and contains `enum MessageTimestampFormatter`.
- `NativeLiveMessageSurface.swift` no longer declares those four symbols.

Use `fs.existsSync` before reading new files so the RED state is an assertion failure rather than an ENOENT error.

- [ ] **Step 2: Run the structural test and verify RED**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts
```

Expected: FAIL because the new files do not exist and the declarations remain in the monolith.

- [ ] **Step 3: Move Markdown and timestamp implementations verbatim**

Move the current implementations from `NativeLiveMessageSurface.swift` into the two new files.

Required signatures remain:

```swift
struct ChatMarkdownView: View
enum ChatMarkdownBlock
enum ChatMarkdownParser
enum MessageTimestampFormatter
```

Remove `private` only where cross-file use requires module-internal visibility. Preserve all parsing/rendering bodies and formatter behavior.

- [ ] **Step 4: Run focused verification**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts
xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: tests PASS; Xcode build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/ChatMarkdown.swift ios/LeileiOS/LeileiOS/Chat/MessageSurface/MessageTimestampFormatter.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): extract chat markdown presentation"
```

### Task 2: Extract message actions / UIKit context menu

**Files:**
- Modify: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageActions.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift`

**Interfaces:**
- Consumes: SwiftUI `UIViewRepresentable`, UIKit `UIContextMenuInteractionDelegate`.
- Produces: unchanged `LightweightContextMenuInteraction(title:copyText:isDisabled:cornerRadius:onCopy:action:)` for `NativeLiveMessageRow`.

- [ ] **Step 1: Extend the structural test**

Assert:
- `NativeLiveMessageActions.swift` contains `struct LightweightContextMenuInteraction` and `final class Coordinator`.
- The root file no longer declares `LightweightContextMenuInteraction`.
- The new file still contains menu titles `"Copy"` and the dynamic action title path.

- [ ] **Step 2: Run the test and verify RED**

Run the boundary test. Expected: FAIL before extraction.

- [ ] **Step 3: Move the context-menu bridge verbatim**

Move `LightweightContextMenuInteraction` and its Coordinator into `NativeLiveMessageActions.swift`. Import `SwiftUI` and `UIKit` there. Preserve coordinator update behavior, disabled attributes, `UITargetedPreview`, corner radius, copy callback, and action callback.

- [ ] **Step 4: Verify**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts
xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS/build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageActions.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): extract chat message actions"
```

### Task 3: Extract Runtime interactions

**Files:**
- Modify: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveInteractions.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift`

**Interfaces:**
- Consumes: `NativeLiveRuntimeInteractionSnapshot`, `NativeLiveJSONValue`, existing async `onResolve` callback.
- Produces:
  - `NativeLivePermissionInteractionCard(interaction:onResolve:)`
  - `NativeLiveQuestionInteractionCard(interaction:onResolve:)`
  with the exact existing callback signature:
```swift
(
    NativeLiveRuntimeInteractionSnapshot,
    [String: NativeLiveJSONValue]
) async throws -> Void
```

- [ ] **Step 1: Extend the structural test**

Assert the new file contains both interaction-card structs and the root file contains neither. Also assert the new file still references `interaction.isPending`/submission state and calls `onResolve(interaction, response)`.

- [ ] **Step 2: Verify RED**

Run the boundary test. Expected: FAIL.

- [ ] **Step 3: Move Permission and AskUserQuestion presentation verbatim**

Move the two card implementations and their local helper/state code into `NativeLiveInteractions.swift`. Preserve option selection, multi-select behavior, validation, submitting/error state, and response payload construction.

- [ ] **Step 4: Verify**

Run boundary test + Xcode build.

Expected: PASS/build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveInteractions.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): extract runtime interactions"
```

### Task 4: Extract Runtime activity and tool presentation

**Files:**
- Modify: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRuntimeActivity.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift`

**Interfaces:**
- Consumes: `NativeLiveRuntimeSurfaceState`, `NativeLiveRuntimeEventSnapshot`, interaction cards from Task 3.
- Produces:
  - `NativeLiveRuntimeAssistantRow(runtimeSurface:onResolveInteraction:)`
  - `AssistantTypingIndicatorRow`
  - `NativeLiveRuntimeToolCallRow(toolUse:events:)`
  - `NativeLiveToolCallCard(toolName:detail:state:)`
  - `NativeLiveToolResultCard(isError:detail:)`
  - `NativeLiveToolDetailSheet(title:status:sectionTitle:detail:)`
  - existing tool-display/JSON-detail helpers.

- [ ] **Step 1: Extend the structural test**

Assert all Runtime/tool symbols above live in `NativeLiveRuntimeActivity.swift` and no longer in the root file. Assert the new file still:
- pairs Runtime `tool_use` and `tool_result` by `tool_use_id`;
- derives `running/completed/failed`;
- renders the latest `activityText`;
- surfaces the first pending interaction.

- [ ] **Step 2: Verify RED**

Run the boundary test. Expected: FAIL.

- [ ] **Step 3: Move Runtime/tool presentation verbatim**

Move the current implementations and helper functions. Preserve the existing individual-tool detail sheet behavior; Mainline 1 will redesign total folding later.

Use module-internal visibility only for symbols referenced by other files.

- [ ] **Step 4: Verify**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts
xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS/build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRuntimeActivity.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): extract runtime activity presentation"
```

### Task 5: Extract current attachment presentation

**Files:**
- Modify: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAttachmentPresentation.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift`

**Interfaces:**
- Consumes: `NativeLiveCurrentPathBlock`, `AppModel.nativeLiveAttachmentDownloadURL`.
- Produces:
  - `NativeLiveAttachmentBlockView(block:)`
  - `NativeLiveAttachmentPreview`
  - `NativeLiveAttachmentQuickLook(fileURL:)`
  - `nativeLiveSafePreviewFilename(_:)`
  with current behavior only.

- [ ] **Step 1: Extend the structural test**

Assert the attachment file contains the four symbols above and the root file no longer does. Pin the current integrity behavior by asserting the extracted file still checks:
- `data.count != expectedSize`;
- `SHA256.hash(data: data)`;
- comparison to `expectedSHA256`;
- temporary-directory removal in `cleanupPreview()`.

- [ ] **Step 2: Verify RED**

Run the boundary test. Expected: FAIL.

- [ ] **Step 3: Move attachment rendering/Quick Look verbatim**

Move the current main implementation only. Import `SwiftUI`, `QuickLook`, `CryptoKit`, and `UIKit` in the extracted file as required.

Do not port #793 gallery/cache/download-slot changes during this task.

- [ ] **Step 4: Verify**

Run boundary test + Xcode build.

Expected: PASS/build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAttachmentPresentation.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): extract attachment presentation"
```

### Task 6: Extract message rows and canonical block rendering

**Files:**
- Modify: `tests/ios-native-live-message-surface-boundaries.test.ts`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageRows.swift`
- Create: `ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageBlocks.swift`
- Modify: `ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift`
- Modify only if path-sensitive assertion requires it: `tests/ios-native-live-older-pagination.test.ts`

**Interfaces:**
- Consumes: Markdown/timestamp utilities (Task 1), message actions (Task 2), Runtime activity (Task 4), attachment presentation (Task 5), `AppModel`, `MindWriteIndicator`, `AlbumSaveIndicator`.
- Produces:
  - `NativeLiveMessageRow`
  - `NativeLiveHistorySnapshotRow`
  - `NativeLiveHistoryForkDivider`
  - `NativeLiveOptimisticUserRow`
  - `NativeLiveBlockView`
  while leaving `NativeLiveMessageSurface` responsible for list composition/pending placement/scrolling.

- [ ] **Step 1: Extend the structural test**

Assert the row/block symbols live in the two new files and no longer in the root. Assert the root still contains:
- `struct NativeLivePendingOperation`;
- `struct NativeLiveMessageSurface`;
- older-history button and `onLoadOlder`;
- pending/replacement/recovered Runtime row placement;
- `.refreshable { ... onRefresh() }`.

- [ ] **Step 2: Verify RED**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts
```

Expected: boundary test FAIL before extraction; existing pagination test remains PASS.

- [ ] **Step 3: Move row and block implementations**

Move row structs and `NativeLiveBlockView` with minimal visibility changes. Keep root composition logic byte-for-byte equivalent where practical.

Do not change which canonical block kinds are rendered; `text`, `tool_use`, `tool_result`, and `attachment` remain exactly as today. Mainline 1 owns later projection/folding changes.

- [ ] **Step 4: Verify focused behavior contracts**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts tests/ios-native-live-current-path-idle.test.ts
xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: all tests PASS; Xcode build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageRows.swift ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageBlocks.swift ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift
git commit -m "refactor(ios): split native live message rows"
```

### Task 7: 0A equivalence verification and review cleanup

**Files:**
- Review all files created/modified in Tasks 1–6.
- No new production behavior should be added.

**Interfaces:**
- Consumes: completed 0A extraction.
- Produces: a reviewable 0A branch whose root surface is composition-only enough for Mainline 1 to add Turn Activity without reopening attachment/Markdown/UIKit implementation internals.

- [ ] **Step 1: Run the complete source-contract set**

Run:
```bash
pnpm exec tsx --test tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts tests/ios-native-live-current-path-idle.test.ts tests/ios-native-live-result-telemetry.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run:
```bash
pnpm typecheck
pnpm check:generated
pnpm test
pnpm build
git diff --check
```

Expected: all commands exit 0. If an unrelated pre-existing failure occurs, record it by exact test/command and do not represent the branch as fully green.

- [ ] **Step 3: Run the iOS build**

Run:
```bash
xcodebuild -project ios/LeileiOS/LeileiOS.xcodeproj -scheme LeileiOS -configuration Debug -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: `BUILD SUCCEEDED`.

- [ ] **Step 4: Perform the two behavior-sensitive device smokes**

On a real device using the refactor branch:
- Long-press a user message and verify Copy + Edit menu behavior/preview remains unchanged.
- Open a real attachment into Quick Look, dismiss it, and verify preview still works with no visible state regression.

Do not broaden this into Mainline 2 attachment acceptance.

- [ ] **Step 5: Inspect the final diff for forbidden behavior changes**

Confirm:
- no API/backend/database files changed;
- no Runtime/canonical model files changed;
- no strings, layout constants, response payloads, tool-state mapping, attachment validation logic, or interaction-response logic were intentionally altered;
- `NativeLiveMessageSurface.swift` now primarily owns pending operation + list/root composition;
- extracted files align with their declared responsibilities.

- [ ] **Step 6: Commit any review-only mechanical cleanup**

Only if necessary:
```bash
git add ios/LeileiOS/LeileiOS/Chat tests/ios-native-live-message-surface-boundaries.test.ts tests/ios-native-live-older-pagination.test.ts
git commit -m "refactor(ios): finish chat surface boundary cleanup"
```

If no cleanup is necessary, do not create an empty commit.

- [ ] **Step 7: Open the 0A pull request**

PR description must state:
- zero behavior change;
- exact files/responsibilities extracted;
- verification commands/results;
- device smoke results;
- #793 deliberately not rebased/ported;
- Mainline 1 remains out of scope.
