# Compact source history restoration

A Desktop JSONL can contain a compact summary and a retained response whose
parent was rewritten to that summary. Treating that file as the entire display
history previously returned `COMPACT_SOURCE_HISTORY_REQUIRED`.

The read-only resolver now searches bounded, regular JSONL files in the same
native project. It follows exact UUIDs, including native `forkedFrom.messageUuid`
renames, and validates retained content. Native usage bookkeeping may change;
message content, response identity, timestamps and stop semantics may not. It
never chooses by title, text, mtime or latest source tail. Conflicting complete
ancestries, missing originals, gaps, changed sources and scan limits fail closed.

Display reconstruction is separate from execution. The SDK root snapshot and
revision are unchanged. Historical messages without a checkpoint in that root
are display-only: no fabricated current-session checkpoint is inserted. Old
message Edit/Retry/Fork support remains deferred.

Only original image/document blocks, with their original ordinals, are stored as
hash-pinned `native-history-assets/<revision>` evidence in the existing store.
These keys are excluded from SDK subagent enumeration. JSONB-independent
canonical hashing verifies evidence after storage, and the existing per-asset
byte hash, owner, revision and attachment checks still apply. No schema or
migration changes are required. Restore payload limits are unchanged.

## Verification (Node 22.23.3)

- RED: compact fork fixture failed with `COMPACT_SOURCE_HISTORY_REQUIRED`.
- RED: real isolated PostgreSQL exposed fabricated historical checkpoints.
- RED: SDK subkey enumeration exposed display asset evidence.
- GREEN: 7 source-history tests; native inspection/source-change tests; complete
  offline Bridge suite: 308 pass, 0 fail, 4 skipped.
- Isolated PostgreSQL restore, preservation, picker and SessionStore suites:
  42 pass, 0 fail, 0 skip. Covers repeated restore, original asset bytes,
  JSONB key order, tampered evidence, SDK isolation and unchanged execution root.
- Authenticated mock API suites: 7 pass, 0 fail, 0 skip.
- Local production runtime gate: 404 root + 156 Bridge pass, 0 fail, 0 skip.
- Root typecheck/build and diff check pass.
- Read-only check of the requested Desktop conversation resolves 2058 display
  messages and 27 asset-bearing records. Its 296-entry SDK root remains unchanged;
  restore body is 17,719,458 bytes, below the existing 30 MiB sender limit. The
  compiled server input validator accepts it. No transcript content is logged.

No Claude query, production restore/write, native-file write, daemon restart,
merge or deployment was performed. Actual phone display and continuing this
conversation require authorized deployment and user acceptance. Source files
must remain available and stable; archives are not automatically restored.
