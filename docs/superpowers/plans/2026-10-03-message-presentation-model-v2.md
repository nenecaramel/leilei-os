# Message Presentation Model v2 Implementation Plan

> Execute in this session with superpowers:executing-plans and test-driven-development; finish with a fresh whole-branch review.

**Goal:** Route canonical, optimistic send and optimistic Edit through one source → projector → visual node → registry pipeline.
**Architecture:** Foundation-only value models preserve canonical metadata and ordering without writing authority. Draft attachment inputs carry identity/state without bytes; views consume projected nodes and reuse existing Markdown/attachment rendering. Unknown and future nodes select a bounded visible fallback. Activity continues to consume original ledger blocks.
**Tech Stack:** Swift, SwiftUI, existing Native Live JSON/API values, Node-driven real Swift fixtures.
**Spec:** User's Mainline 2B request; docs/message-presentation-model-v2.md records the final contract.

## Constraints and review focus

No backend authority/schema changes, new canonical voice kind, transport/cache/gallery/viewer/rich renderer, or protected workflow-file edits. Preserve #812/#813, ordinary Activity and #815 duration. Cover duplicate ordinals, empty/attachment-only drafts, editing voice into keyboard text, selected retained attachments, bounded unknown diagnostics, every reserved future node's fallback, and canonical readback replacing draft state.

- [x] Foundation models/projector: write real Swift fixture covering required canonical/draft/Edit/voice/unknown/copy/ordering behavior; observe RED, implement shared source and nodes, observe GREEN.
- [x] Registry/view integration: reuse existing renderers, make fallback visible, route canonical/send/Edit through the projector, and map composer attachments to shared inputs. Update ordinary Activity regression to consume the new body projector; run real Swift behavior and iOS build.
- [x] Verification/review: focused Swift/source contracts, question/voice/tool/duration regressions, isolated Postgres where relevant, static/generated/build/diff/runtime/full suite vs exact main; fresh reviewer checks the complete branch.
- [x] Commit/push independent PR with base/head, changed files, contract and validation; clean task-only residue and stop without merge.

## Verification outcome

Exact fetched main: `4dd948a4bcb0605f929c7662dd29733b958dda9c`. Final focused presentation/tool/question/voice-encoding: 5 passed; 2A contract/storage/question: 37 passed; isolated Postgres duration/content/question/voice: 4 passed. Runtime gate: 405 root + 101 bridge passed; complete bridge: 123 passed. Root typecheck/generated/build and final unsigned arm64 Simulator build passed. Mapped iOS contracts: 10 passed plus the pre-existing invalid-regex file failure.

Complete exact-main suite: 2085 tests, 1981 passed, 10 failed, 94 skipped. Complete PR suite: 2086 tests, 1982 passed, the same 10 failed, 94 skipped. Failure-name delta: none added or removed. #815 clock-sensitive Swift duration failure reproduces on exact main. Voice controller passed both complete suites; mixed focused reruns encountered its unchanged timeout timing assertion. No historical failures were repaired in this PR.

Independent whole-branch review found Send/Edit attachment-only ordinal parity; actual Swift RED test confirmed it, fix matched backend resulting ordinals while retaining attachment identity/metadata, then GREEN. Reviewer rechecked the fix with no remaining actionable finding. Device/production acceptance remains outside this local PR validation.
