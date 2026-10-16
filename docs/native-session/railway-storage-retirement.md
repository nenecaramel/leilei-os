# Railway old full-history replica retirement

Scope: legacy root JSONL copies (subpath = '') and
native-history-assets/* records in native_live_provider_session_entries,
plus the specifically identified 813-message record from
native_live_conversation_history_snapshots. All deletes must use an
explicit audited user_id + session_id + subpath allowlist; no table TRUNCATE.

Protected: conversations, conversation_messages,
conversation_content_blocks (including 768 old local messages), canonical
checkpoints and owner/lease/turn state, ordinary attachments and bucket,
unfinished jobs and recovery/outbox evidence, native status preservation
markers, Mac JSONL / Desktop indexes / archives / backups.
Keep the separately reported 51 attachment 404s untouched.

Retirement patch: the legacy full-history restore/state/release/asset and
asset-stage internal routes return HTTP 410. The old external history
snapshot read API also returns HTTP 410; snapshot uploads are rejected.
LeileiOS no longer fetches the 813-message display projection or offers
its JSONL history-upload picker. The authenticated remote SessionStore /append API now refuses native-history-assets/*.
The lower-level store remains available for isolated legacy recovery tests;
ordinary session transcripts and new canonical messages are untouched.

The runtime's default persistent Mac session registry has no remote
SessionStore configured, but an explicit old full-history restore can
still use old stored snapshots. A production cleanup therefore requires
source-level retirement of those endpoints and dependent readers before
deleting any rows.

Run scripts/db/native-history-assets-audit.sql read-only to obtain exact
identity and dependency facts. The SQL shows checkpoint and bootstrap
references, which must not be confused with proof that the old JSONB
replica is needed; distinguish native Session identity from copy bytes.

The existing scripts/db/backup_postgres.sh creates encrypted full
PostgreSQL dumps; scripts/db/restore_verify_postgres.sh verifies the
restore in a local temporary/test database. The 2026-10-16 run created
a new encrypted full backup and verified all 64 business-table counts,
table inventory, migration ledger and user mapping against PostgreSQL 18.
The duplicate positional/--dbname psql arguments discovered during that
restore are fixed here with regression coverage. Do not place credentials,
private manifests or backup material in Git.

scripts/db/native-history-assets-reclaim.sql refuses execution until
a per-session allowlist from the owner's audit is vetted. Do not
autogenerate a delete from totals or current continuation mode alone.
When root replica records are removed, keep preserve_external_session
and change any false 'complete' status to 'incomplete' atomically.

SQL DELETE normally frees reusable database pages, not guaranteed
immediate ext4 disk reduction; VACUUM FULL requires separate approval.
51 attachment 404s are an independent incident.

## Verified before production rollout — 2026-10-16

- The actual Swift snapshot-refresh method now clears stale display state
  without an API dependency, including the Chat page-refresh path. Its
  executable Swift characterization covers repeated refreshes.
- Node 22.23.3: targeted retirement/backup tests 21 pass; runtime gate
  566 server + 281 bridge pass; complete Bridge suite 508 pass / 4 live
  opt-in skips. Root typecheck/build pass. Xcode 27 unsigned Simulator
  build succeeds. No model calls or daemon restart were performed.
- Direct session DB regressions: 61 pass / 0 fail / 0 skip. Tests exercise continuation, session preservation, picker,
  rejection of retired HTTP uploads without DB/object/local-file writes,
  and retained low-level recovery validation.
- Full isolated Postgres gate: 149 pass, 2 reported failures (one failing
  leaf plus its parent). The same Memory literal-keyword/malformed-temporal
  assertion fails on clean main; unrelated Mind code is unchanged.
- Full ordinary suite uses existing Node 24.19.0: branch 2,660 pass /
  27 fail / 252 skip; clean main 2,664 pass / 27 fail / 252 skip. Failure
  title sets are identical: zero newly failing titles. Retired API tests
  change the total case count; skips are not passes.
- A separate local restored-copy rehearsal matched 11,632 exact entry
  IDs/user/session/subpath/content hashes, removed those and the one
  snapshot, changed nine root-copy statuses to incomplete while retaining
  all nine preservation flags, and compared every other table unchanged
  (62 tables, including the ledger). A stale content hash refused the
  transaction and left all tables unchanged. This proves mechanics, not
  that deployed consumers/producers are retired.

## Remaining production gate

No production row was deleted and no rollout is implied by the tests.
Keep the SQL reclaim entry point fail closed until the user approves the
reviewed rollout and exact cleanup scope. Recheck the deployed SHA/410
contracts, active work, append/result outboxes, bootstrap/compact/cleanup
references and manifest drift immediately before deletion. A later run
must use locks that prevent producer/dependency changes during its checks.

The currently bound native Session has its local original. Some historical
candidate Sessions are absent from the checked local projects/archive
locations; their Railway bytes are retained in the verified encrypted
backup. Do not remove that backup. The separately missing 51 Bucket objects
are not repaired by this operation and neither their metadata nor their
canonical content blocks are deletion targets.
