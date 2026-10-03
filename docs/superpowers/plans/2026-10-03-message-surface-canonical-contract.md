# Message Surface v2 A implementation plan

Goal: classify Claude output before presentation, retain bounded compatibility data, and preserve legacy conversation reads.

Architecture: versioned product identities use existing JSON payload/rawType storage. New extension identities use the existing physical unknown kind. Runtime execution remains Activity; only explicit backend projection may make its structured output canonical.

Spec: ../../message-surface-v2-canonical-contract.md

Scope: no presentation changes, voice changes, durable question trace, production migrations or merge.

- [x] Inspect pinned SDK/exported message and Beta content types, existing bridge fixtures, canonical writer, both readers and attachment binding.
- [x] Write and run failing boundary tests for tool execution, subagents, unknown provider content, binary and structured output.
- [x] Add bridge compatibility envelope, structured tool parts and result-level payload preservation.
- [x] Add product identity/projection/ref contract and update canonicalizer, storage encoding and both readers.
- [x] Retain existing ready-file ownership/transaction path and annotate its authoritative identity/references.
- [x] Run focused tests, bridge suite, typecheck, generated check, full suite, build and whitespace gate; isolate baseline failures.
- [ ] Commit, push, open PR, record acceptance limitations and stop for review.

Review focus: future schema versions; oversized/cyclic inputs; thinking and PDF bytes; resource candidates posing as attachments; legacy records and Retry/Edit lineage. Boundary tests cover these inputs. No new physical schema or destructive rewrite.

Validation evidence: targeted regressions were observed failing before fixes and passing afterward. Independent code review additionally found key collisions, reasoning readback and structured-output retention gaps; regression coverage now pins those fixes. An isolated local Postgres cluster ran the new content-contract test and existing conversation/turn integration suites; existing migrations applied to this empty test database and schema ledger validation passed. No production DB or runtime refresh was performed. Nine unrelated root-suite failures were reproduced against origin/main in a temporary baseline snapshot; details belong to PR verification evidence, not the architecture contract.
