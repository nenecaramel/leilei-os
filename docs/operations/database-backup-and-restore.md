# Database backup and restore operations

This runbook covers Leilei OS PostgreSQL backups. It intentionally separates
Railway platform backups from encrypted logical backups kept outside Railway.
Never paste connection strings, passwords, tokens, or encryption passphrases
into this document, tickets, screenshots, shell history, or Git.

## Current production topology

Confirmed:

- Railway project: `carefree-spontaneity`
- Environment: `production`
- API service: `leilei-os`
- Database service: Railway Postgres with a persistent `postgres-volume`
- Vercel hosts only the static Web SPA; its checked-in configuration does not
  connect directly to PostgreSQL.
- The API receives `DATABASE_URL` from Railway service variables.
- The currently injected database endpoint is a Railway public connection
  endpoint, not a `railway.internal` private endpoint.
- The application uses `postgres` through Drizzle ORM and requires TLS.
- Drizzle migrations live in `drizzle/` and run with `npm run db:migrate`.
- Auth0 subjects are not stored in a dedicated database table. The allowed
  Auth0 subject maps server-side to `MCP_USER_ID`, which must exist in
  `users.id`.
- Critical application tables include `users`, `core_memories`,
  `diary_entries`, `tasks`, and `user_settings`.

Railway's Backups page currently reports that Backups and point-in-time
recovery require the Pro plan and that `postgres-volume` has no backups.
Therefore, the Volume is persistent storage but is not itself a verified
backup.

Not yet confirmed:

- Exact Railway resource ceilings for CPU, memory, storage, and egress.
- A private-network `DATABASE_URL` migration plan.
- A paid-plan backup retention policy, because Railway backups are not enabled.
- A successful external production backup and temporary restore drill.

## Platform backups versus external logical backups

Railway Backups/PITR are provider-managed snapshots tied to the Railway
project and plan. They can shorten recovery time but remain in the same
provider and administrative account.

The external script creates a PostgreSQL custom-format logical dump, a
non-content manifest with critical-table counts, and then encrypts both into
one artifact. It is portable to a separate PostgreSQL instance and protects
against a Railway project or account incident. Keep both layers when the
project moves to a plan that supports platform backups.

## Prerequisites

Install compatible PostgreSQL client tools:

- `pg_dump`
- `pg_restore`
- `psql`

`pg_dump` must be the same major version as the production PostgreSQL server
or newer. The restore script similarly refuses `pg_restore` older than the
`pg_dump` version recorded in the encrypted manifest.

OpenSSL 3 is used for AES-256-CBC encryption with PBKDF2. The restore host is
restricted to `localhost`, `127.0.0.1`, or `::1`, and the database name must
contain `temp`, `test`, `verify`, or `restore`.

Choose an external backup directory, for example an encrypted external disk.
Do not put it inside the repository. Provide an encryption passphrase of at
least 16 characters through a secure prompt or a temporary environment
variable. A password manager-generated value is recommended.

## Create an encrypted logical backup

Export production credentials through an approved secret manager or run the
script in a Railway-injected environment. Do not put literal values in shell
history:

```bash
export DATABASE_URL="<production connection supplied securely>"
export MCP_USER_ID="<database user UUID supplied securely>"
export LEILEI_BACKUP_DIR="/absolute/path/outside/the/repository"
read -r -s LEILEI_BACKUP_PASSPHRASE
export LEILEI_BACKUP_PASSPHRASE
./scripts/db/backup_postgres.sh
unset LEILEI_BACKUP_PASSPHRASE DATABASE_URL MCP_USER_ID
```

The script:

1. refuses repository-internal output;
2. creates an unencrypted custom dump only in a private temporary directory;
3. records counts without reading or printing private content;
4. encrypts the dump and manifest;
5. securely removes temporary material on exit;
6. refuses to overwrite an existing artifact;
7. writes a separate SHA-256 file.

The manifest count query and `pg_dump` do not share one exported snapshot.
Writes occurring between those operations can produce a count mismatch even
when the dump is valid. Treat such a mismatch as a reason to repeat the backup
during a quiet/maintenance window; never waive the check silently.

## Verify the checksum

From the external backup directory:

```bash
shasum -a 256 -c "<backup-file>.sha256"
```

Do not proceed if verification fails.

## Restore and verify in a temporary database

Create a disposable local PostgreSQL database whose name clearly includes
`restore`, `verify`, `temp`, or `test`. Never point this script at Railway,
Supabase, another remote host, or a database with an ambiguous name.

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

The restore script checks the encrypted artifact's SHA-256, restores schema
and data, verifies critical tables, compares counts, and verifies the mapped
database user when the source manifest contains that check. It never prints
Memory, Diary, Task, Settings, or user content.

Delete the disposable local database or container after verification. Retain
only the encrypted artifact and its checksum.

## Production incident recovery

1. Stop application writes or place the API into a controlled maintenance
   state.
2. Confirm the incident scope and preserve the current database before making
   any recovery change.
3. Verify the chosen backup checksum.
4. Restore into a separate temporary database first.
5. Compare schema version, critical tables, counts, and mapped user.
6. Have a second operator review the target and recovery evidence.
7. Provision a new production database rather than restoring over the damaged
   one.
8. Run application smoke tests against the new database.
9. Change `DATABASE_URL` only through Railway's production variable UI after
   explicit approval.
10. Keep the previous `DATABASE_URL` reference available for rollback; never
    publish its value.
11. Monitor API health and data consistency before resuming writes.

To roll back a `DATABASE_URL` switch, select the prior database reference in
Railway production variables and redeploy. This is a production mutation and
requires an approved incident change window.

## Commands forbidden against production

Never run the following against production:

- `dropdb`, `DROP DATABASE`, `DROP SCHEMA`, or `DROP TABLE`
- `TRUNCATE`
- `pg_restore --clean`
- destructive `drizzle-kit push`
- seed commands unless an approved runbook explicitly requires them
- ad-hoc UPDATE or DELETE statements used as a recovery shortcut

`restore_verify_postgres.sh` deliberately refuses remote targets and requires
two explicit temporary-environment flags.

## Secret and artifact storage

- Store the encrypted artifact and checksum outside Git and outside Railway.
- Keep the encryption passphrase in a password manager, separately from the
  artifact.
- Never store unencrypted dumps.
- Restrict the backup directory and files to the current user.
- Maintain at least one offline or independently administered copy.
- Test restoration regularly; a backup that has not been restored is
  unverified.

Recommended starting schedule for this single-user system:

- encrypted logical backup daily;
- retain daily backups for 14 days;
- retain one weekly backup for 8 weeks;
- perform a temporary restore drill monthly and after schema migrations;
- enable Railway Backups/PITR after upgrading to an eligible plan.

Adjust retention after measuring database growth and applicable privacy
requirements.

## Backup and restore record template

Do not mark an item successful until it was actually performed.

```text
Backup created at (UTC):
Schema version:
Encrypted artifact location:
SHA-256 verified: yes / no
Railway internal backup status:
Temporary restore tested at (UTC):
Temporary database/container:
Critical table structures verified: yes / no
Critical counts matched: yes / no
Mapped database user verified: yes / no / unavailable
Temporary database deleted: yes / no
Operator:
Notes and unresolved risks:
```
