# PR 3b: Native session turn slot

Implement the supplied 3b brief inline, in this disposable worktree. No migration,
production DB, daemon refresh, merge or unrelated ownership lifecycle changes.

1. Run same-environment isolated PostgreSQL baseline with every native DB flag.
   Add real database row/JSON disagreement tests for admission/renewal, input,
   finalization, background snapshot/append, Wake and missing-slot failure; run RED.
2. In session-owner.ts add explicit set-turn upsert and anchor CAS, preserving
   writer generation and owner/revision mirroring. Move all slot readers to the
   row, remove the JSON key only on prepare, preserve existing locks and refusal
   outcomes. Prove GREEN against the same tests.
3. Add a shared test row helper and migrate the seven JSON-based fixture files,
   preserving assertions and backfill testing. Run all native DB suites serially;
   compare failure names to baseline. Verify CAS rejects stale anchors without
   partial canonical writes and owner sync never overwrites the turn.
4. Run typecheck, build, runtime gate, ordinary suite, diff/hygiene gates and
   independent review. Document scope and actual counts; open a PR without merging.
   Verify CI outcome separately, preserve canonical checkout, remove task worktrees.
