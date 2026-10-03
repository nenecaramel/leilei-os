# Mainline 2D plan and ledger

Spec: user-provided Mainline 2D request, 2026-10-03. Base: 98ff75a9d44cdf3210be8aed736990d1e6894c1a. Execute inline with TDD and a fresh whole-branch reviewer before PR. No merge or live runtime operations.

- [x] Audit SDK/provider and canonical authority; RED→GREEN for forged normalized projection, then opaque backend authorization with ready/owned attachment resolution. No current SDK signal enables automatic projection.
- [x] Actual Swift RED→GREEN for typed v1 structured parts, bounded JSON, search/citation relations, pending/unsupported and validated media refs through B projector/registry.
- [x] Native JSON/search/source/result renderer composition through the existing registry and C media; safe HTTP(S) capability; preserve part order, copy and fallback markers.
- [ ] Compatibility/real SDK fixtures, Postgres backing+separate projection regressions; required focused/runtime/bridge/compile checks and sequential exact-main full suite.
- [ ] Fresh review, fixes with RED→GREEN, independent PR, physical acceptance pending, task-only cleanup.

Interfaces: backend authorization produces the existing canonical envelope and validates attachment refs; Swift consumes that envelope without provider payload parsing. D child nodes preserve parent canonical identity and do not create ledger rows. Text citations preserve provider relation and aggregate sources separately without changing canonical ordinal.

Review focus: provider-forged projection; hidden/ambient/question leakage; nested bounded envelopes and flags; invalid refs; SDK relation identity versus display-only indices; no unsafe URL execution or metadata fetching; no duplicated media transport; long/malformed/future parts and copy semantics.

Task 1: complete — provider-forged normalized projection test RED→GREEN; backend/A focused 19 passed. Opaque backend decision and owned/ready ref resolver replace normalized payload authority. No production share signal is invented.
Task 2/3: complete — real Swift D model RED→GREEN, generation origin RED→GREEN, search-source relation RED→GREEN. Final model fixture passed; Swift D/B/C/tool/question/voice focused 11 passed.
Integration/gates: isolated Postgres 6 passed, zero skipped; existing focused 93 passed; production gate 405+101 passed; complete bridge 125 passed; typecheck/generated/build passed; Simulator initial build passed, final build pending after source refinements.

Final review: fresh whole-branch reviewer found four Important issues, no Critical/Minor. All four were reproduced before changes: actual Swift runs failed independently for local search relation loss, JSON node-budget clipping and semantic type/value collision; durable storage regression failed for semantic envelope depth. One fix pass preserved wrapper-compensated semantic depth with shared budgets, retained local source relations, marked shortened arrays incomplete and copied semantic JSON literally. Review-fix focused 6 passed. Real normalize→authorize→Postgres/readback→Swift integration then passed in the six-test DB set, zero skipped. No second reviewer was dispatched; covering RED→GREEN tests and final full verification own the fix evidence.

Final: Ruling: no automatic SDK share producer — the spec forbids guessing absent an authoritative share signal; only explicit backend infrastructure is enabled — subsequent producer work is required before execution results are shared in production.
Final: Ruling: future token/transaction producer lifetime remains documented integration work — there is no current producer/endpoint; future decisions must resolve owned refs within canonical write transactions — future producers must implement that transaction contract.
Final: Ruling: physical-device validation stays pending — the user explicitly defers D acceptance to Mainline 3, and C media acceptance is still pending — device behavior is not yet accepted.
Final: Ruling: final full-suite delta/Simulator are executor validation — rerun after this review fix pass — historical baseline failures remain visible, not repaired incidentally.
Final: Ruling: E–H surfaces remain outside D — native structured/search/citation and C reuse are the requested scope — rich Markdown/Artifact/interactive features remain subsequent work.
