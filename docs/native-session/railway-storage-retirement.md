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
its JSONL history-upload picker. All native-history-assets SessionStore
appends are rejected regardless of conversation mode; ordinary session
transcripts and new LeileiOS canonical messages are untouched.

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
restore in a local temporary/test database. This precondition has NOT
been performed from this change. Do not place credentials or backup
material in Git.

scripts/db/native-history-assets-reclaim.sql refuses execution until
a per-session allowlist from the owner's audit is vetted. Do not
autogenerate a delete from totals or current continuation mode alone.
When root replica records are removed, keep preserve_external_session
and change any false 'complete' status to 'incomplete' atomically.

SQL DELETE normally frees reusable database pages, not guaranteed
immediate ext4 disk reduction; VACUUM FULL requires separate approval.
51 attachment 404s are an independent incident.
