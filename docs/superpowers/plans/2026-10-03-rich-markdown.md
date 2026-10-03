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
- Initial cross-mainline focused: 75/75; after streaming path: 76/76. Isolated localhost PG integrations: 7/7, zero skipped.
- Runtime gate: 405 root + 101 bridge passed. Complete bridge: 125 passed. Typecheck/generated/build/diff passed. Unsigned Simulator build passed.
- Exact-base full suite under Node24.19.0: 2096 tests, 1991 passed, 10 failed, 95 skipped. Final delta pending final run.

