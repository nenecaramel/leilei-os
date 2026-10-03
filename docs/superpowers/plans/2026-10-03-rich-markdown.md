# Mainline 2E — Rich Markdown presentation

Base: `6b65436641ccbd9ec18c14b44e25db1a94599c54` as specified by the user; no latest-main verification. Only this missing commit object was downloaded.

Architecture: retain canonical/structured text parent nodes, raw text and citation ownership. A bounded Foundation projector produces range-addressed child nodes; the sole renderer registry selects native Markdown, code, table, diff, math and Mermaid source views. No new dependencies, persistence identities or backend/Activity behavior.

1. Audit current projection, renderer, structured text/citations and dependencies.
2. RED→GREEN real Swift fixture; implement bounded parser/model and native renderers. Preserve user/voice/media, raw copy, provenance and citation aggregation.
3. Run E/A/B/C/D/voice/question/Activity/current-path and isolated Postgres regressions, runtime/bridge/typecheck/generated/build and unsigned Simulator.
4. Compare sequential full suite with exact base under Node 24; list failure names. Fresh independent review, address important findings, push and open PR; no merge.
5. Remove only task-created dependencies/builds/DB/worktrees after preserving work in Git.

Math rendering level: bounded LaTeX fallback. Syntax highlighting: language-aware label with plain selectable monospace fallback. Mermaid source only; no execution. Full typesetting/visual engines remain G. F–H out of scope.

Mainline 3 rich-surface physical acceptance: pending. C media acceptance remains independently pending.

## Evidence
- RED→GREEN: missing typed fence/raw copy, inline paragraph composition, cache, actual streaming route and heading math source ranges.
- Independent read-only review of `fd7b7d82`: no Critical; five Important findings and one Minor. Addressed all in one pass with real Swift RED→GREEN: shared descendant node budget, whole-paragraph formatting across math, local links/matched backtick spans, original CRLF offsets, linear quote scanning; also removed complete CRLF fence terminator.
- Reviewer declined full math typesetting/Mermaid execution (explicit G scope), physical acceptance (Mainline 3 pending), and final full-suite status (verified separately below).
- Real Swift E: 93 primary assertions plus 15 combined/budget/CRLF/deep-quote review assertions in six independent executable runs. Source-contract checks are supplemental.
- Final cross-mainline focused after review fixes: 76/76. Isolated localhost PG integrations: 7/7, zero skipped.
- Runtime gate: 405 root + 101 bridge passed. Complete bridge: 125 passed. Final typecheck/generated/build/diff passed. Final unsigned Simulator build passed after review fixes.
- Exact-base full suite under Node24.19.0: 2096 tests, 1991 passed, 10 failed, 95 skipped. Final PR full suite: 2100 tests, 1995 passed, 10 failed, 95 skipped. Added failure names: `[]`. Removed failure names: `[]`. Same 10 historical failure names below. Suites ran sequentially (baseline first, PR second), same Node24.19.0/dependencies, concurrency=1, default DB integration skips.

## Exact baseline failure names

- `CI checks after a failed gate still run once their setup succeeds`
- `CI reports all verification surfaces independently for PR and push`
- `CI scopes database access to Postgres gates and preserves every verification command`
- `authenticated Native Live internal JSON can exceed the public 1mb limit`
- `iOS Runtime UI prefers SDK tool display names and surfaces API retry state`
- `real Swift Activity preserves final duration and explicitly presents nested permission`
- `tests/ios-native-live-message-surface-boundaries.test.ts`
- `the app JSON parser accepts a 100k CJK Diary body`
- `the app JSON parser remains bounded above 1mb`
- `unauthenticated Native Live internal JSON does not get the larger parser budget`

## Scope / closeout

Agent status and verify plan used the exact supplied comparison base; unmapped documentation/Swift fixtures were manually covered by real Swift compilation and the explicit test matrix. Dependency symlinks are disposable verification scaffolding, not product changes. No protected workflow, package manifest, canonical persistence, Activity projection or dependency files changed. `NativeLiveRuntimeActivity.swift` only routes streaming Chat text into presentation; Activity behavior is unchanged.

No production refresh/deploy/database operation or physical-device claim. Commit/push/open PR, then task-only cleanup; preserve the owner checkout and unrelated worktrees. Do not merge.
