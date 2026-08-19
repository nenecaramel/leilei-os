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
- The current production migration head on `main` is `0023_faulty_sphinx`.

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
3. record verification metadata without reading or printing private content;
4. encrypt the dump and manifest;
5. remove temporary plaintext material on exit;
6. refuse accidental overwrite;
7. write a separate SHA-256 checksum.

If source counts and dump contents can drift because writes occur between
queries, repeat the backup during a quiet/controlled window. Never waive a
count mismatch silently.

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
- schema restoration;
- expected critical tables and indexes;
- representative table-count agreement;
- expected migration-ledger state;
- mapped database user availability;
- representative repository read paths;
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
5. capture non-secret pre-change readback such as relevant table existence,
   representative counts, migration ledger, and dependency checks;
6. restore the fresh backup to disposable PostgreSQL of the supported major
   version;
7. confirm restored counts/ledger match the pre-change readback;
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

## Current Health Stage B gate

Health product runtime removal Stage A is already complete. The obsolete
`health_records` table remains intentionally present in the current production
schema because destructive Stage B is still isolated in Draft PR #174.

PR #174 adds forward migration `0024_brainy_wildside` with the intended schema
operation:

```sql
DROP TABLE "health_records";
```

The migration intentionally fails closed rather than using `IF EXISTS` or
`CASCADE`. Historical migrations and migration-ledger history must remain
unchanged.

**PR #174 must remain unmerged and undeployed until a fresh production backup
and disposable PostgreSQL 18 restore rehearsal have been completed for its
exact head.** Prior backup/restore drills are historical recovery evidence; they
do not authorize this destructive migration.

The Stage B disposable rehearsal must additionally verify:

- `health_records` exists before migration and has expected pre-change state;
- no unexpected current dependency requires `health_records`;
- the exact migration runner applies only the pending `0024` change;
- `health_records` is absent afterward;
- `public.leilei_schema_migrations` records the expected new head;
- representative unrelated durable table counts remain unchanged;
- a second migration-runner invocation is a no-op;
- infrastructure `GET /health` remains available while retired product
  `/api/v1/health` remains absent.

Sending or possessing a production database credential never counts as merge
or mutation authorization.

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
Critical table structures verified: yes / no
Critical counts matched: yes / no
Mapped database user verified: yes / no / unavailable
Exact migration runner tested: yes / no / not applicable
Second migration runner no-op: yes / no / not applicable
Application/readback checks passed: yes / no
Disposable database deleted: yes / no
Operator:
Notes and unresolved risks:
```
