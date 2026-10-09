# Database backup and restore operations

This runbook covers Leilei OS PostgreSQL backups, restore verification, and
destructive-migration release gates. It intentionally separates Railway
platform backups from encrypted logical backups kept outside Railway.

Never paste connection strings, passwords, tokens, or encryption passphrases
into this document, tickets, screenshots, shell history, or Git.

## Current production topology

Confirmed:

- GitHub release trunk: `main`.
- Railway project: `carefree-spontaneity`.
- Environment: `production`.
- API service: `leilei-os`.
- Database service: Railway PostgreSQL with persistent volume storage.
- Vercel hosts only the static Web SPA and does not connect directly to
  PostgreSQL.
- The API receives `DATABASE_URL` from Railway service variables.
- The application uses PostgreSQL through Drizzle ORM and requires TLS.
- Checked-in migrations live under `drizzle/`.
- Railway production runs the compiled migration runner
  `node dist/database/migrate.js` as a pre-deploy gate.
- Normal application startup does not run migrations.
- The migration runner records the accepted migration head in
  `public.leilei_schema_migrations` and validates the legacy
  `drizzle.__drizzle_migrations` ledger during bootstrap.
- Historical verified-production snapshot (recorded 2026-09-06): `0033_health_v2_daily_summaries`. This is not a claim about the current production migration head; obtain that value from approved live release verification.

Railway platform backups/PITR are not assumed to be available. Persistent
volume storage is not itself a verified backup.

## Backup layers

Leilei OS uses three distinct recovery layers with different purposes.

### 1. Railway platform backup / PITR

Use provider-managed backup/PITR when the active Railway plan supports it.
This can shorten recovery time inside the same provider, but it does not
replace a provider-independent logical backup.

### 2. External encrypted PostgreSQL logical backup

The repository backup tooling creates a PostgreSQL custom-format logical dump,
a non-content manifest with verification metadata, and an encrypted artifact
stored outside Railway and outside Git.

Required properties:

- use compatible `pg_dump`, `pg_restore`, and `psql` clients;
- create the backup outside the repository;
- encrypt the artifact;
- keep the encryption passphrase separately;
- record a SHA-256 checksum;
- never print private record contents or credentials;
- restore the artifact into a disposable PostgreSQL instance before treating
  it as verified.

### 3. Leilei OS product export

The versioned application Export/Restore feature is useful for user-facing
portability and recovery, but it is not a substitute for a full database
backup before schema changes.

Current Full Backup v4 exports Mind as Memory-only while retaining
`mind_continuity` as historical archive data. Product Restore accepts v2/v3/v4
within their existing supported scope, normalizes legacy `feel`, and never writes
retired Mind state kinds. Historical Continuity restoration requires valid owned
Memory and canonical evidence dependencies; it does not restart old processing.
See [Mind backup compatibility](../mind.md#full-backup-v4-and-historical-archives)
for archive contents and limits. Keep historical JSON files that cannot be restored
into the current product model. Full historical database recovery remains the
verified encrypted logical-backup path below, using a compatible schema in a
disposable instance rather than weakening current production constraints.

## Create an encrypted logical backup

Obtain production credentials through an approved secret source. Do not put
literal production credentials in scripts, Git, documentation, shell history,
or issue/PR bodies.

Example:

```bash
export DATABASE_URL="<production connection supplied securely>"
export MCP_USER_ID="<database user UUID supplied securely>"
export LEILEI_BACKUP_DIR="/absolute/path/outside/the-repository"
read -r -s LEILEI_BACKUP_PASSPHRASE
export LEILEI_BACKUP_PASSPHRASE
./scripts/db/backup_postgres.sh
unset LEILEI_BACKUP_PASSPHRASE DATABASE_URL MCP_USER_ID
```

The backup script must:

1. refuse repository-internal output;
2. keep unencrypted temporary material private and short-lived;
3. read the actual production head from `public.leilei_schema_migrations`
   and map that timestamp to the checked-in Drizzle journal instead of naming
   the backup from the repository head alone;
4. inventory every current `public` application table (excluding the
   migration ledger, which is verified separately) and record only its row
   count — never row contents — in the encrypted manifest;
5. create a PostgreSQL custom-format dump;
6. encrypt the dump and manifest;
7. remove temporary plaintext material on exit;
8. refuse accidental overwrite;
9. write a separate SHA-256 checksum.

New backups use manifest format `leilei-os-postgres-backup-v2`. The restore
tool intentionally retains read compatibility with historical v1 manifests so
older verified recovery artifacts are not invalidated by this tooling change.

The logical dump itself is transactionally consistent, while manifest counts
are separate verification metadata. If source counts and dump contents can
drift because writes occur between queries, repeat the backup during a
quiet/controlled window. Never waive a count mismatch silently.

## Verify the checksum

From the external backup directory:

```bash
shasum -a 256 -c "<backup-file>.sha256"
```

Do not proceed if verification fails.

## Restore and verify in a disposable PostgreSQL instance

The restore target must be disposable and clearly non-production. The checked
restore tooling deliberately refuses ambiguous or remote production-like
targets.

Example:

```bash
export LEILEI_ALLOW_TEMP_RESTORE=1
export LEILEI_RESTORE_TARGET_ENV=temporary
export TEMP_DATABASE_URL="postgresql://127.0.0.1/leilei_restore_verify"
export BACKUP_FILE="/external/path/<backup-file>.backup.enc"
export MCP_USER_ID="<database user UUID supplied securely>"
read -r -s LEILEI_BACKUP_PASSPHRASE
export LEILEI_BACKUP_PASSPHRASE
./scripts/db/restore_verify_postgres.sh
unset LEILEI_BACKUP_PASSPHRASE TEMP_DATABASE_URL MCP_USER_ID
```

A successful verification should establish, without printing private content:

- checksum validity;
- source/target PostgreSQL major-version compatibility;
- schema restoration;
- for v2 backups, exact equality of the restored `public` table inventory;
- for v2 backups, row-count agreement for every manifest-listed `public`
  table;
- for v2 backups, exact restored `leilei_schema_migrations` head timestamp
  and hash;
- for historical v1 backups, the legacy critical-table/count checks encoded
  by that format;
- mapped database user availability when the source manifest recorded it;
- representative repository read paths when performing an actual release or
  incident drill;
- cleanup of the disposable database/container after verification.

Retain only the encrypted artifact, checksum, and non-secret verification
metadata.

## Destructive migration gate

A destructive migration is not authorized merely because an older backup or
restore drill exists. Before every destructive production migration, create a
fresh backup and verify it against the exact change being proposed.

Required order:

1. fresh `main` and exact PR head are identified;
2. production remains read-only with respect to the proposed destructive
   migration;
3. create a new external production logical backup;
4. verify its SHA-256 and archive readability;
5. capture non-secret pre-change readback; manifest v2 already records the
   complete `public` table inventory/counts and exact migration-ledger head,
   while change-specific dependency checks may still be added;
6. restore the fresh backup to disposable PostgreSQL of the same major
   version;
7. require restored public-table inventory/counts and migration-ledger head to
   match the encrypted v2 manifest;
8. build the exact PR head;
9. run the real compiled Leilei OS migration runner only against the disposable
   restored database;
10. verify the intended schema change and unchanged unrelated durable data;
11. run the migration runner a second time and require a no-op result;
12. perform representative application/readback checks;
13. only then may the destructive PR become eligible for merge/deploy;
14. after production deployment, verify the production migration head and
   service health again.

Any unexpected dependency, count mismatch, ledger anomaly, restore failure, or
migration-runner discrepancy is a stop condition. Never use `CASCADE` or an
ad-hoc production workaround to force a destructive migration through its
gate.

## Historical Health Stage B gate

Health product runtime removal Stage A and destructive Stage B are complete.
PR #174 (`0024_brainy_wildside`) was merged on 2026-08-20 after its destructive
database gate passed. It is historical recovery/release evidence, not a current
merge or deployment gate.

The historical verified-production snapshot recorded on 2026-09-06 was
`0033_health_v2_daily_summaries`; it is not the current production migration
head. Future destructive migrations must satisfy the general destructive
migration gate above with fresh, exact-head recovery evidence.

## Production incident recovery

1. Stop or control application writes if continuing writes could worsen the
   incident.
2. Preserve the current database state before making recovery changes.
3. Verify the chosen backup checksum.
4. Restore into a separate disposable database first.
5. Compare schema version, critical tables, counts, and mapped user.
6. Run representative application reads/smoke tests against the restored copy.
7. Prefer provisioning a replacement production database over destructive
   in-place restore when practical.
8. Change production `DATABASE_URL` only through the deployment platform and
   only after explicit recovery approval.
9. Keep the previous database reference available for rollback without
   publishing its value.
10. Monitor API health and data consistency before resuming normal writes.

## Commands forbidden against production without an explicitly approved runbook

Never improvise the following directly against production:

- `dropdb`, `DROP DATABASE`, `DROP SCHEMA`, or `DROP TABLE`;
- `TRUNCATE`;
- `pg_restore --clean`;
- destructive `drizzle-kit push`;
- seed commands unless an approved procedure explicitly requires them;
- ad-hoc UPDATE/DELETE statements used as a recovery shortcut.

Destructive schema operations must travel through reviewed forward migrations
and the backup/restore gate above.

## Secret and artifact storage

- Store encrypted backup artifacts and checksums outside Git and outside
  Railway.
- Keep encryption passphrases in a password manager, separately from artifacts.
- Never retain unencrypted dumps as durable backups.
- Restrict backup directories/files to the intended operator.
- Maintain at least one independently administered/offline copy when possible.
- Restore-test backups regularly; an untested backup is not considered verified
  for a destructive release gate.

## Historical verified backup/restore record

The repository retains the following older drill as historical recovery
proof. It is **not** a current destructive-migration authorization.

A real read-only production logical backup and disposable PostgreSQL 18 restore
were completed on 2026-07-28 UTC.

- Backup created at: `2026-07-28T04:10:29Z`
- Production PostgreSQL server/client major: 18
- Schema version at that time: `0006_large_chat`
- Encrypted artifact:
  `leilei-os_20260728T041029Z_0006_large_chat.backup.enc`
- SHA-256:
  `c2f8eff0dae14a812d828126820d0ed214b4f10156d9b6c8a0b8511c825b80f9`
- Checksum verification: passed
- Restore target: disposable PostgreSQL 18 bound to localhost
- Source/restored counts matched for the recorded critical tables
- Auth0-to-database mapped user verification passed
- Representative repository reads and user-isolation checks passed
- Temporary database/container and plaintext material cleanup were verified

Later backups/restores, when performed, should be recorded separately with
non-secret metadata. For a destructive migration, the active PR must still
reference a fresh gate run rather than relying on this historical section.

## Verified backup/restore record — 2026-08-27

A fresh production recovery rehearsal was completed against source/rehearsal
head `ff29504254275933dbdd552369bfbd55c36404ff`. Production access was read-only: `SHOW`, `SELECT`, catalog
inspection, and `pg_dump` only.

- Backup created at: `2026-08-27T11:05:09Z`
- Production PostgreSQL major: 18 (`server_version_num=180006`)
- Migration head: `0026_universe_diary_provenance`
- Leilei migration ledger exact match: `1787308495658|fdeb9c6294cedd52e053aa93b3e6f179a21c23772b89d8ce377bde3c17d32ef5`
- Encrypted artifact: `leilei-os_20260827T110509Z_0026_universe_diary_provenance.backup.enc`
- SHA-256: `a1aa82e42ea8965c9484f1592c058265b6591ea6bfd75560807ff925c6790cfe`
- Independent checksum verification: passed
- Restore target: disposable localhost PostgreSQL 18 with TLS
- Source/restored current durable counts matched exactly:
  `users=1`, `core_memories=8`, `diary_entries=39`, `tasks=2`,
  `user_settings=1`, `todo_papers=5`, `todo_entries=10`, `tool_calls=40`,
  `mcp_write_idempotency=77`, `resource_lifecycle_events=74`,
  `data_import_runs=0`, `universe_meta=1`, `universe_galaxies=8`,
  `universe_nodes=13`, `universe_relations=9`, `universe_revisions=53`,
  `universe_backups=0`, `universe_diary_sources=16`
- `0026` provenance primary key, node foreign key, diary foreign key, and
  `diary_entries_user_id_id_uidx` verification: passed
- Compiled migration runner executed twice against the restored database:
  passed/no pending migration
- Memory, Diary, Task, Todo, and Universe representative repository readback:
  passed without printing private contents
- Source-manifest mapped-user verification: unavailable; repository readback
  used the restored database's single active user without logging its UUID
- Disposable PostgreSQL data directory, TLS plaintext material, and listener:
  removed/closed
- Retained recovery material: encrypted backup and SHA-256 checksum only,
  outside Git and Railway

## Backup and restore record template

Do not mark an item successful until it was actually performed.

```text
Backup created at (UTC):
Source main SHA:
Exact change/PR head SHA:
Schema version before change:
Encrypted artifact location:
SHA-256 verified: yes / no
Archive/list verification: yes / no
Pre-change counts/ledger captured: yes / no
Disposable restore tested at (UTC):
Disposable PostgreSQL version:
Public table inventory matched manifest: yes / no / v1
Manifest table counts matched: yes / no / v1
Migration ledger exact head matched: yes / no / v1
Mapped database user verified: yes / no / unavailable
Exact migration runner tested: yes / no / not applicable
Second migration runner no-op: yes / no / not applicable
Application/readback checks passed: yes / no
Disposable database deleted: yes / no
Operator:
Notes and unresolved risks:
```

### Settings and portable backup contract

Web Settings has Account, Status, Data and About at `/settings/account`,
`/settings/status`, `/settings/data` and `/settings/about`. `/settings` defaults to
Account. Old `/system`, `/system/account`, `/system/connections`, `/system/data` and
`/system/about` bookmarks redirect to their corresponding Settings destination.
The former Activity bookmark redirects to Account. Backend `/system/connections`,
`/system/data` and `/system/claude-usage` retain their API paths and meanings.

System/Settings Activity is retired on Web and iOS; its dedicated HTTP endpoint,
page DTOs and read queries are removed. This does not retire Native Live Tool,
Task or Runtime Activity, log writers, resource lifecycle processing or their
stored records. No log tables or historical records are deleted.

New Full Backup v4 files omit `audit` entirely, and both clients no longer offer
an audit export switch. The export service no longer queries audit/log tables.
Legacy export URLs with `include_audit` have no effect, like other unused query
parameters; they cannot enable audit export. Historical v2/v3/v4 files may still
contain valid `audit.lifecycle` and `audit.tool_activity`; preview identifies
these diagnostics and restores only the supported product modules, never the
historical audit rows. Normal safe restore-run auditing remains active.
