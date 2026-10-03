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
