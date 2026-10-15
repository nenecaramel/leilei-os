# Railway native history storage reduction (after #1109)

Observed production SQL before the new architecture: 182 MB
`native_live_provider_session_entries`, with 167 MB of its size in TOAST.
Approximately 136 MB of the recent 169 MB stored JSONB was under
`native-history-assets/*`, which copied old images/documents for display.

**Already deployed**: the new #1109 continuation-only daily switch does
not stage/transmit full old history or these assets. The old explicit
full-history route remains for compatibility.

This change enforces the separation **on the server**:
- New requests to append or stage `native-history-assets/*` for a Session
  currently bound to a continuation-only conversation fail with HTTP 409.
- Ordinary new LeileiOS messages, active turn checkpoints, Memory, tasks,
  attachments and old explicit legacy sessions are unaffected.
- No automatic deletions. No automatic migration. No new storage tables.

Run `scripts/db/native-history-assets-audit.sql` for a read-only per-Session
breakdown of cached bytes and legacy dependencies.

`scripts/db/native-history-assets-reclaim.sql` is intentionally guarded
and **cannot run by accident**. Do not run it on production without an
independently verified backup, explicit authorization to remove old
display-only copies, confirmation that a Session is not in active use,
and testing on a restored database. It only processes a small, bounded
batch for continuation-only sessions with no active legacy references.
Old legacy sessions are excluded. Keep snapshots/archives untouched.

PostgreSQL DELETE frees reusable space inside the DB, and WAL can grow
temporarily. The on-disk Volume is not promised to shrink without
additional table compaction or migration. Do not run VACUUM FULL during
normal production operation.
