# Repository Maintainability Refactor Design

Date: 2026-10-02

## Status

Approved direction. This document defines Mainline 0: a repository-structure refactor that must preserve product behavior and authority semantics.

## Purpose

LeileiOS has grown by adding real product capabilities faster than its original file and directory boundaries have evolved. Several files now combine unrelated responsibilities, which increases the amount of context required for routine changes and makes it easier to accidentally mix UI presentation, transport, runtime state, canonical data, and domain behavior.

Mainline 0 exists to reduce that maintenance cost before the next three product mainlines:

1. Tool/task activity total folding + return-layering UI.
2. Attachment rendering redesign.
3. Rich rendering / visual surface.

The refactor is not a product feature. Its purpose is to make those three product changes safer and cheaper to build.

## Hard constraint: zero product behavior change

Every Mainline 0 pull request must preserve current externally observable behavior.

Do not intentionally change:

- API routes, request/response contracts, or authentication behavior.
- Database tables, columns, constraints, migration ledger, or stored-data semantics.
- Canonical Conversation identity, lineage, content, or commit rules.
- Runtime / interaction / control / observability authority.
- Provider session or Workspace identity semantics.
- Retry / Edit / Send behavior.
- Attachment identity, provenance, transfer, validation, or storage behavior.
- Existing iOS product behavior or visual design.
- Background, Mind, Effect, Proactivity, or Context semantics.

If a functional bug is discovered while moving code, record it and fix it in a separate PR. Do not hide a behavioral change inside a refactor PR.

Purely mechanical import-path, symbol-visibility, file-placement, and composition changes are allowed when runtime behavior is unchanged.

## Current structural pain points

### 1. Chat surface owns too many concerns

`NativeLiveMessageSurface.swift` currently contains message-list composition, history fork presentation, user and assistant rows, optimistic rows, live Runtime presentation, Permission and AskUserQuestion UI, tool cards, tool detail sheets, attachment presentation, Quick Look integration, UIKit context-menu bridging, Markdown parsing, and timestamp formatting.

This makes every Chat change expensive to reason about and directly blocks the next three product mainlines.

### 2. iOS transport, DTOs, and domain APIs are collapsed into one client file

`LeileiAPIClient.swift` contains shared transport behavior, a large set of DTOs, feature-specific request/response envelopes, and endpoint methods for Native Live, Mind, Workspace, System, Import, and other areas.

The generic HTTP client and feature contracts should not require opening the same multi-thousand-line file.

### 3. AppModel owns multiple independent state machines

`AppModel.swift` currently coordinates authentication, conversation lists/lifecycle, active conversation state, attachment upload, Send/Retry/Edit, current-path reads, Runtime observation, Runtime interactions, mid-turn input, interrupts, Mind-write refresh, Album-save refresh, and connectivity.

The refactor should separate client-side coordination by lifecycle without creating a second product authority.

### 4. Large feature views combine UI, models, transport, editors, and layout engines

`DaySpaceView.swift`, `DiaryView.swift`, and large Universe files combine several responsibilities that can be physically separated while preserving the same SwiftUI behavior.

### 5. Native Live API routers are registration and implementation monoliths

`native-live-router.ts` and `native-live-relay-internal-router.ts` each combine many endpoint families. Route paths and handler contracts are stable, but physical organization no longer reflects feature boundaries.

### 6. Runtime protocol parsing is concentrated in one file

`native-live-runtime-protocol.ts` contains protocol versions and types plus command parsing, result parsing, environment parsing, telemetry, output resources, SessionStore health, VCS changes, bounded JSON helpers, and validation.

It needs a compatibility facade over smaller protocol modules.

### 7. Turn repository implementation is too broad

`native-live-backend-turn-repository.ts` contains prepare Send/Retry/Edit, reads, Mind prompt persistence, success/failure finalization, Workspace checks, cleanup, and related transaction logic.

The public repository contract should remain stable while implementation is separated by transaction responsibility.

### 8. Database schema is physically monolithic

`src/database/schema.ts` contains nearly the entire product schema. The database contract is already conceptually separated by domain, but the file is not.

Schema splitting must not create or require a migration.

### 9. `bridge` and `runtime` directories have become broad buckets

The directories now contain enough unrelated Native Live, Mac, backend, protocol, session, attachment, background, Mind, Context, Effect, and Proactivity code that navigation depends too heavily on remembering exact filenames.

Directory cleanup should improve discovery without forcing a repository-wide redesign.

### 10. Some test files mirror production monoliths

Large test files should be split along the same behavior boundaries as production code. Shared fixtures should be extracted only when they represent genuinely shared setup, not to create a universal test utility.

## Design principles

### Preserve authority boundaries

Physical module boundaries must reinforce the existing product contract:

- Canonical Conversation data remains authoritative for chat history.
- Runtime State remains separate from canonical content.
- Observability remains non-authoritative and fail-soft where currently specified.
- iOS stores/controllers coordinate reads and UI state; they do not become durable truth.
- Provider-native signals remain execution truth where already adopted.
- Database repositories retain transaction ownership where atomicity matters.

### Prefer facades over repository-wide import churn

When a large public module already has many consumers, split its implementation behind a stable facade first. Re-export existing symbols from the current import path until a later change has a concrete reason to migrate consumers.

Examples:

- `src/database/schema.ts` remains a compatibility export surface.
- `native-live-runtime-protocol.ts` remains a compatibility facade.
- Turn repository public types/class entry point remain stable while internals move.

### Split by responsibility, not by arbitrary line count

File size is a warning signal, not a rule. A file should be split when it owns multiple independently understandable responsibilities, especially when it combines transport, DTOs, state machines, rendering, parsers, persistence, or domain logic.

### Keep refactor PRs narrow and reviewable

Mainline 0 is delivered as a sequence of independently reviewable PRs. A PR should primarily move/extract one boundary and verify equivalence. Do not combine unrelated cleanup merely because both are structural.

### No speculative abstractions

Do not introduce generic repositories, universal coordinators, generic feature frameworks, protocol registries, or test-helper layers unless at least two existing concrete consumers need the abstraction.

## Mainline 0 sequence

### 0A. Chat and iOS Native Live client boundaries

This phase is first because the next three product mainlines all depend on Chat.

Target structure:

```text
ios/LeileiOS/LeileiOS/Chat/
  MessageSurface/
    NativeLiveMessageSurface.swift
    NativeLiveMessageRow.swift
    NativeLiveMessageBlocks.swift
    MessageActions/
    RuntimeActivity/
    Interactions/
    Attachments/
    Markdown/
```

The exact filenames may vary during implementation, but responsibilities must end up separated.

Expected ownership:

- Surface root: list composition, pending/replacement placement, scrolling.
- Message rows: user/assistant/history/optimistic row composition.
- Runtime Activity: live execution presentation only.
- Interactions: Permission and AskUserQuestion presentation.
- Attachments: attachment presentation and preview integration.
- Markdown: Chat Markdown rendering/parsing.
- Message actions: copy/retry/edit/context-menu presentation.

No behavior change is allowed while extracting these parts.

#### #793 handling

PR #793 is currently a draft attachment implementation that diverges from main and touches the same Chat files. It is not an accepted product baseline.

Do not force-rebase its 55 commits through Mainline 0.

Instead:

1. Preserve the branch/PR as a reference implementation and source of already-learned attachment behavior.
2. Perform Mainline 0A from current main.
3. After Mainline 0 is stable, start Mainline 2 from the refactored main.
4. Port or reimplement only the useful #793 behavior into the new attachment boundary, with fresh acceptance against the current product requirements.
5. Retire #793 only after its useful behavior is accounted for.

This avoids making an unaccepted feature branch the structural base of the repository.

### 0B. iOS API and application-state boundaries

Target direction:

```text
Infrastructure/
  API/
    APIClient.swift
    NativeLive/
      Models.swift
      NativeLiveAPI.swift
    Mind/
    Workspace/
    System/
    Import/

App/
  AppModel.swift
  AuthStore.swift
  ConversationStore.swift
  NativeLiveTurnController.swift
  NativeLiveRuntimeStore.swift
```

Names are illustrative; responsibility boundaries are normative.

Rules:

- Shared HTTP/auth/error handling stays in the generic API client.
- Feature DTOs and envelopes move near their feature API surface.
- `AppModel` becomes composition/root state, not a second data authority.
- Conversation list/lifecycle state, active turn control, and Runtime observation become separable client coordination units.
- No new persistence layer is introduced.

### 0C. Large iOS feature files

Split Day Space, Diary, and Universe by existing responsibility without redesigning their UI.

Typical target shape:

```text
Pages/DaySpace/
  DaySpaceView.swift
  DaySpaceModels.swift
  DaySpaceStore.swift
  TodoPaper/
  DiaryPaper/
  Editors/
  Layout/
```

Diary and Universe should follow the same principle, not necessarily the same exact folder template.

Extraction order should follow the least coupled boundaries first: models/helpers, reusable subviews, editor bridges, layout logic, then state coordination if needed.

### 0D. Native Live web/API and protocol modules

Split route implementation while keeping existing router entry points and URL contracts.

Target direction:

```text
src/web-api/native-live/
  router.ts
  conversations.ts
  turns.ts
  runtime.ts
  attachments.ts
  external-sessions.ts
  compact.ts

src/web-api/native-live-internal/
  router.ts
  execution.ts
  runtime-events.ts
  interactions.ts
  background.ts
  sessions.ts
  attachments.ts
  album.ts
```

Runtime protocol target:

```text
src/domains/bridge/runtime-protocol/
  types.ts
  command.ts
  result.ts
  environment.ts
  telemetry.ts
  resources.ts
  session-store.ts
  vcs.ts
  parsing.ts
```

`native-live-runtime-protocol.ts` remains a facade/re-export surface during Mainline 0.

### 0E. Turn repository and schema physical split

Turn repository target direction:

```text
src/domains/bridge/turn-repository/
  repository.ts
  prepare.ts
  reads.ts
  finalize-success.ts
  finalize-failure.ts
  cleanup.ts
```

The current public repository entry point may remain as a facade.

Important constraint: transaction boundaries are semantic boundaries. Do not split an atomic transaction merely to make files shorter.

Database schema target direction:

```text
src/database/schema/
  users.ts
  diary.ts
  todo.ts
  conversation.ts
  native-live.ts
  runtime.ts
  mind.ts
  attachments.ts
  universe.ts
  system.ts
  index.ts

src/database/schema.ts  // compatibility re-export
```

Schema refactor acceptance requires proving generated SQL/database metadata is unchanged. No migration file should be added solely because the TypeScript schema was split.

### 0F. Directory navigation and tests

After the major boundaries exist, reorganize broad Native Live implementation buckets enough that code can be discovered by responsibility.

Target direction:

```text
src/domains/native-live/
  backend/
  mac/
  protocol/
  session/
  attachments/
  background/
```

This phase must be conservative. Mind, Context, Effect, Proactivity, Conversation, and other already meaningful domains should not be pulled into a generic Native Live bucket merely for visual symmetry.

Split large tests alongside the production boundary they verify. Preserve behavior coverage and test intent.

## Verification strategy

Each structural PR must include evidence appropriate to the moved code.

### TypeScript/backend

At minimum, where applicable:

- typecheck.
- deterministic canonical suite.
- focused tests for the moved module.
- PostgreSQL regression suite when repository/schema/transaction code moves.
- generated-artifact check.
- build.

Because GitHub-hosted Actions quota is exhausted for the current billing cycle, verification may temporarily run locally/self-hosted. A missing hosted runner must not be represented as a code failure or code success.

### iOS

At minimum:

- Xcode build for the LeileiOS scheme.
- existing source/contract tests that inspect iOS behavior.
- true-device acceptance only when a refactor touches behavior-sensitive SwiftUI/UIKit integration whose equivalence cannot be established by build/static tests alone.

A structural extraction does not become permission to visually redesign a component.

### Schema

Schema splitting requires an explicit no-diff check on the schema/migration representation used by the repository. No new migration should appear.

### API routers

Route inventory and request/response contract tests must prove that endpoints remain registered at the same paths with the same auth and validation behavior.

## PR sequencing and merge discipline

- One structural boundary per PR where practical.
- Start each PR from fresh main.
- Do not stack many long-lived refactor branches unless one PR cannot be meaningfully tested without the previous one.
- Merge verified extraction PRs promptly to reduce drift.
- Before each PR, inspect active branches touching the same files.
- A concurrent product PR that overlaps heavily should either land first or be explicitly preserved as reference and rebuilt later; do not solve large divergence with blind conflict resolution.
- Never mix a discovered functional fix into the extraction commit.

## Bug discovery protocol

If Mainline 0 exposes an existing behavioral problem:

1. Record the exact symptom and current behavior.
2. Finish or pause the structural extraction without changing that behavior.
3. Open a separate bug branch/PR from the appropriate main state.
4. Fix with its own regression evidence.
5. Resume structural work from refreshed main.

This keeps review evidence honest.

## Completion criteria

Mainline 0 is complete when:

- Chat/runtime/attachment/markdown/interaction presentation is no longer concentrated in one message-surface file.
- iOS generic transport, feature API contracts, and independent Native Live client state machines have clear physical boundaries.
- Day Space, Diary, and major Universe files no longer mix all of view, transport DTOs, editors, and layout logic in one source file.
- Native Live external/internal routers are composed from feature route modules.
- Runtime protocol parsing has smaller internal modules behind a stable facade.
- Turn repository implementation is split without weakening transaction boundaries.
- Database schema is physically split behind a compatibility export with no DB migration or schema change.
- Broad Native Live folders are easier to navigate by responsibility.
- Large tests are split where they mirror the old production monoliths.
- All merged Mainline 0 PRs are behavior-preserving by their verification evidence.
- Mainlines 1, 2, and 3 can proceed on the refactored main without depending on temporary compatibility hacks introduced solely for Mainline 0.

## Explicit non-goals

Mainline 0 does not:

- implement activity total folding.
- redesign attachment rendering.
- implement Rich Message Blocks or WKWebView visual rendering.
- change Recall, Proactivity, Schedule, Context lineage, Retry/Edit semantics, Foreground Sync, or Workspace semantics.
- implement Railway backup/PITR work.
- redesign the entire project into a new architecture style.
- enforce arbitrary maximum file lengths.
- remove compatibility facades merely for aesthetic cleanliness.

## Maintenance rule after Mainline 0

Future work should treat a file that accumulates transport + DTO + state machine + rendering + parsing/persistence responsibilities as a boundary smell even if its line count is still modest.

The goal is not small files. The goal is local reasoning: a maintainer should be able to change one product concern without loading unrelated subsystems into context.
