# Visual Renderer Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this session; one fresh independent reviewer checks the completed branch.

**Goal:** Render display Math, Mermaid and verified SVG safely offline without implementing F.
**Architecture:** Preserve Canonical → Projection → Visual Node → the existing sole Registry. Foundation input/security/lifecycle models feed a renderer-owned local WKWebView shell. C's integrity-verified bytes feed a strict SVG subset sanitizer; all errors retain native/source/file fallback.
**Tech Stack:** Swift/Foundation/SwiftUI/WebKit; pinned local MIT KaTeX0.19.0 and Mermaid12.1.0. No root package change.
**Spec:** `docs/superpowers/specs/2026-10-03-visual-renderer-foundation.md` (user-supplied complete specification).
**Base:** `dc454173a1154dad2ea5c6b66e105e10005c7ad0`, verified after explicit fetch.

## Global constraints
- Mainline2F: deferred/skipped, not done. H covers A–E+G only. No Artifact/Resource/MCP App producer, host, lifecycle, negotiation or bridge.
- Display Math: full visual renderer; inline Math: native LaTeX fallback retained. E parsing/canonical copy unchanged.
- Runtime network=none. Only allowlisted bundled assets; ephemeral WebKit, deny navigation/window.open/file/remote loads. No provider HTML/URL input or arbitrary native/JS bridge.
- SVG only from C nativeLiveAttachmentBytes; size/SHA required and rechecked by sanitizer. No new downloader/cache; source fallback + verified original open remain available.
- Input/render/height budgets, generation tokens, bounded coalescing, timeout, cancellation, teardown on disappear/background/process failure.
- Protected backend/workflow/package/template files untouched. Physical rich-surface and C media gates remain pending. PR only; no merge.

## Review focus
1. A late success/height/error from older source cannot replace a new render: deterministic state-machine tests.
2. Hostile SVG with namespaces/entities/CSS/events/remote references is rejected before WebKit: real XML parser tests.
3. Mermaid directives, links and DOM-capable labels cannot upgrade authority: engine configuration and real local runtime tests.
4. Assets really appear in the signed-resource-free Simulator app and work offline: real macOS WebKit executable fixture plus Simulator build.
5. Scroll/background/memory recovery does not retain old process/tasks or show an empty visual: timeout/cancel/reuse state tests and source fallback UI.

### Task1: Foundation contracts and registry
- [x] RED real Swift registry/input/state/SVG tests; input accepts only typed Math/Mermaid/sanitized SVG, no generic HTML or URL.
- [x] Implement bounded input, generation/state/bridge/navigation/height policy and strict XML SVG sanitizer consuming NativeLiveLoadedAttachment.
- [x] Move existing registry authority to its own file; explicit fallback all future/F kinds; SVG attachment decision stays metadata-only in registry.
- [x] GREEN real Swift models and existing A–E model compilers.

### Task2: Offline engine and WebKit host
- [x] RED actual local engine fixture: KaTeX equations, Mermaid graph/sequence/error, network/navigation and stale height denial.
- [x] Bundle pinned assets + licenses/provenance/size/hashes and reproducible task-local build instructions. Static shell and safe structured argument calls only.
- [x] Implement scheme allowlist, CSP, nonpersistent WKWebView, minimal bridge, debounced generations, timeout/process errors, teardown/lifecycle/height.
- [x] GREEN real macOS WebKit integration executable using production shell/host and unsigned Simulator build.

### Task3: Visual adapters / C verified SVG
- [x] RED shared registry dispatch and verified SVG/input/cache/preview regressions.
- [x] DisplayMath/Mermaid source/copy/retry accessible wrappers; SVG inline/fullscreen reuse same sanitized verified bytes, original Quick Look via C lease.
- [x] Theme/DynamicType/ReduceMotion updates and fallback; no parser/backend rewrite or bitmap gallery change.
- [x] GREEN focused G and B–E/voice/question/ordinary-hidden-ambient Activity regressions.

### Task4: Verification / review / PR / closeout
- [x] Isolated localhost PG retention/canonical/media integration, runtime gate, full bridge, typecheck/generated/build/diff and unsigned Simulator.
- [x] Sequential Node24 full exact-main baseline then PR; compare added/removed failure names.
- [x] Fresh independent whole-branch review; RED→GREEN fixes for important findings, rerun relevant/final gates.
- [x] PR `feat: add sandboxed visual renderers`, exactbase/head/files, licenses/sizes/offline/security/lifecycle/inlineMath limitation/F deferred/physical pending. Do not merge.
- [x] Commit/push/attach PR, hygiene and only task-created artifacts cleanup.

## Evidence / review ledger
- Initial RED: display Math registry dispatch; bridge NSNumber Boolean generation acceptance; real WebKit found shell initialization before DOM ready. Corrected and verified with actual engines.
- Foundation GREEN: 106 real Swift assertions, including registry/exhaustive fallback, typed factories, SVG sanitizer/integrity/load generations, deterministic timeout/height/navigation.
- Runtime GREEN: 41 real WebKit host/engine assertions; repeated against the bundle copied into the unsigned Simulator app. Includes fractions/matrices/graph/sequence/errors/theme/CSP/navigation/popup/stale height/reuse/process retry/SVG C cache and constrained SVG geometry/capacity.
- Independent read-only review found two Important issues (stale SVG download completion, width/height-only SVG cropping). Both fixed; reviewer recheck found no remaining Critical/Important issue. Regression RED against reviewed behavior, then GREEN against fixes.
- Focused A–E/current-path/question/ordinary-hidden-ambient Activity: 30/30; extra A storage/voice/Activity finish: 16/17, one exact-main historical Activity fixture failure. iOS settings contract: 5/5.
- Isolated localhost PostgreSQL: 7/7, zero skips. Canonical/content/structured/question-retention/voice/duration/attachment migration/ordinary+suppressed Activity. Task DB stopped after execution.
- Production runtime gate: 405/405 root + 101/101 bridge. Complete bridge:125/125. Root typecheck/generated/build and Web Node24 typecheck/build: pass. Unsigned arm64 Simulator: BUILD SUCCEEDED; packaged assets executed by real WebKit.
- Node24.19 same-environment sequential full baseline (`dc454173...`) then PR: baseline2100/1995pass/10fail/95skip; PR2105/2000pass/10fail/95skip. Added failure names: []; removed failure names: []. Historical failure names recorded below.
- Diff and index diff checks: pass after generated vendor trailing whitespace normalization; runtime hashes regenerated and engines revalidated.
- Verification plan reviewed: native-live/Web/iOS/bridge gates all covered; unmapped docs reviewed and fixtures directly compiled/executed. No production refresh/device/production DB action; physical acceptance remains pending.
- PR/cleanup closeout happens after this evidence commit; stop at review, never merge.

Unchanged full-suite failures:

- CI checks after a failed gate still run once their setup succeeds
- CI reports all verification surfaces independently for PR and push
- CI scopes database access to Postgres gates and preserves every verification command
- authenticated Native Live internal JSON can exceed the public 1mb limit
- iOS Runtime UI prefers SDK tool display names and surfaces API retry state
- real Swift Activity preserves final duration and explicitly presents nested permission
- tests/ios-native-live-message-surface-boundaries.test.ts
- the app JSON parser accepts a 100k CJK Diary body
- the app JSON parser remains bounded above 1mb
- unauthenticated Native Live internal JSON does not get the larger parser budget
