#!/usr/bin/env bash
set -euo pipefail

umask 077

fail() {
  printf 'Restore refused: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    fail "required command '$1' is not installed"
}

[[ "${LEILEI_ALLOW_TEMP_RESTORE:-}" == "1" ]] ||
  fail "set LEILEI_ALLOW_TEMP_RESTORE=1 for an intentional temporary restore"

case "${LEILEI_RESTORE_TARGET_ENV:-}" in
  temporary|test) ;;
  *) fail "LEILEI_RESTORE_TARGET_ENV must be 'temporary' or 'test'" ;;
esac

[[ -n "${TEMP_DATABASE_URL:-}" ]] ||
  fail "TEMP_DATABASE_URL is required"
[[ -n "${BACKUP_FILE:-}" ]] ||
  fail "BACKUP_FILE is required"
[[ -f "${BACKUP_FILE}" ]] ||
  fail "the encrypted backup file does not exist"

if [[ -n "${DATABASE_URL:-}" && "${TEMP_DATABASE_URL}" == "${DATABASE_URL}" ]]; then
  fail "the restore target matches DATABASE_URL"
fi
if [[
  -n "${PRODUCTION_DATABASE_URL:-}" &&
  "${TEMP_DATABASE_URL}" == "${PRODUCTION_DATABASE_URL}"
]]; then
  fail "the restore target matches PRODUCTION_DATABASE_URL"
fi

require_command node
TARGET_CLASSIFICATION="$(
  TEMP_DATABASE_URL="${TEMP_DATABASE_URL}" node -e '
    try {
      const url = new URL(process.env.TEMP_DATABASE_URL);
      const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      const database = decodeURIComponent(url.pathname.slice(1));
      const marked = /(temp|test|verify|restore)/i.test(database);
      process.stdout.write(local && marked ? "allowed" : "refused");
    } catch {
      process.stdout.write("refused");
    }
  '
)"
[[ "${TARGET_CLASSIFICATION}" == "allowed" ]] ||
  fail "only an explicitly named local temporary/test database is allowed"

PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
PSQL_BIN="${PSQL_BIN:-psql}"
OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
CHECKSUM_FILE="${LEILEI_BACKUP_CHECKSUM_FILE:-${BACKUP_FILE}.sha256}"

require_command "${PG_RESTORE_BIN}"
require_command "${PSQL_BIN}"
require_command "${OPENSSL_BIN}"
require_command tar
require_command shasum

[[ -f "${CHECKSUM_FILE}" ]] ||
  fail "the SHA-256 checksum file does not exist"

EXPECTED_HASH="$(awk 'NR == 1 {print $1}' "${CHECKSUM_FILE}")"
ACTUAL_HASH="$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')"
[[ "${EXPECTED_HASH}" =~ ^[0-9a-f]{64}$ ]] ||
  fail "the checksum file is invalid"
[[ "${ACTUAL_HASH}" == "${EXPECTED_HASH}" ]] ||
  fail "the encrypted backup checksum does not match"

if [[ -z "${LEILEI_BACKUP_PASSPHRASE:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Backup decryption passphrase: " LEILEI_BACKUP_PASSPHRASE
    printf '\n' >&2
    export LEILEI_BACKUP_PASSPHRASE
  else
    fail "LEILEI_BACKUP_PASSPHRASE is required in non-interactive mode"
  fi
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/leilei-restore.XXXXXX")"
ARCHIVE_PATH="${TEMP_DIR}/backup.tar.gz"

cleanup() {
  unset LEILEI_BACKUP_PASSPHRASE
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT HUP INT TERM

if ! "${OPENSSL_BIN}" enc \
  -d \
  -aes-256-cbc \
  -pbkdf2 \
  -iter 200000 \
  -pass env:LEILEI_BACKUP_PASSPHRASE \
  -in "${BACKUP_FILE}" \
  -out "${ARCHIVE_PATH}" \
  2>"${TEMP_DIR}/openssl.error"; then
  fail "backup decryption failed"
fi

ARCHIVE_ENTRIES="$(tar -tzf "${ARCHIVE_PATH}" | LC_ALL=C sort)"
EXPECTED_ENTRIES=$'database.dump\nmanifest.txt'
[[ "${ARCHIVE_ENTRIES}" == "${EXPECTED_ENTRIES}" ]] ||
  fail "the encrypted archive contains unexpected files"
tar -C "${TEMP_DIR}" -xzf "${ARCHIVE_PATH}"

manifest_value() {
  awk -F= -v key="$1" '$1 == key {print $2}' "${TEMP_DIR}/manifest.txt"
}

BACKUP_FORMAT="$(manifest_value format)"
case "${BACKUP_FORMAT}" in
  leilei-os-postgres-backup-v1|leilei-os-postgres-backup-v2) ;;
  *) fail "the backup manifest format is unsupported" ;;
esac

SOURCE_SERVER_MAJOR="$(manifest_value postgres_server_major)"
[[ "${SOURCE_SERVER_MAJOR}" =~ ^[0-9]+$ ]] ||
  fail "the source PostgreSQL major version is missing from the manifest"

if ! TARGET_SERVER_VERSION_NUM="$(
  "${PSQL_BIN}" "${TEMP_DATABASE_URL}" \
    -X -A -t -v ON_ERROR_STOP=1 \
    -c "SHOW server_version_num;" \
    2>"${TEMP_DIR}/target_version.error"
)"; then
  fail "the temporary PostgreSQL server version could not be verified"
fi
[[ "${TARGET_SERVER_VERSION_NUM}" =~ ^[0-9]+$ ]] ||
  fail "the temporary PostgreSQL server version is invalid"
TARGET_SERVER_MAJOR="$((TARGET_SERVER_VERSION_NUM / 10000))"
[[ "${TARGET_SERVER_MAJOR}" -eq "${SOURCE_SERVER_MAJOR}" ]] ||
  fail "the temporary PostgreSQL major version must match the backup source"

SOURCE_PG_DUMP_MAJOR="$(manifest_value pg_dump_major)"
PG_RESTORE_MAJOR="$(
  "${PG_RESTORE_BIN}" --version |
    awk '{for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+(\.[0-9]+)*$/) {split($i, v, "."); print v[1]; exit}}'
)"
[[ "${SOURCE_PG_DUMP_MAJOR}" =~ ^[0-9]+$ ]] ||
  fail "the source pg_dump version is missing from the manifest"
[[ "${PG_RESTORE_MAJOR}" =~ ^[0-9]+$ ]] ||
  fail "pg_restore version could not be determined"
[[ "${PG_RESTORE_MAJOR}" -ge "${SOURCE_PG_DUMP_MAJOR}" ]] ||
  fail "pg_restore must not be older than the pg_dump that created the backup"

if ! PGDATABASE="${TEMP_DATABASE_URL}" "${PG_RESTORE_BIN}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --dbname="${TEMP_DATABASE_URL}" \
  "${TEMP_DIR}/database.dump" \
  2>"${TEMP_DIR}/pg_restore.error"; then
  fail "pg_restore failed; the temporary database may be incomplete"
fi

MISMATCHES=0

compare_count() {
  local key="$1"
  local actual="$2"
  local expected="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Count mismatch: %s expected=%s actual=%s\n' \
      "${key}" "${expected}" "${actual}" >&2
    MISMATCHES=$((MISMATCHES + 1))
  else
    printf '%s count verified: %s\n' "${key}" "${actual}"
  fi
}

if [[ "${BACKUP_FORMAT}" == "leilei-os-postgres-backup-v1" ]]; then
  TABLE_CHECK="$(
    "${PSQL_BIN}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      --dbname="${TEMP_DATABASE_URL}" \
      -c "SELECT
        to_regclass('public.users') IS NOT NULL,
        to_regclass('public.core_memories') IS NOT NULL,
        to_regclass('public.diary_entries') IS NOT NULL,
        to_regclass('public.tasks') IS NOT NULL,
        to_regclass('public.user_settings') IS NOT NULL;" \
      2>"${TEMP_DIR}/table_check.error"
  )"
  [[ "${TABLE_CHECK}" == "t|t|t|t|t" ]] ||
    fail "one or more v1 critical tables are missing after restore"

  RESTORED_COUNTS="$(
    "${PSQL_BIN}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      --dbname="${TEMP_DATABASE_URL}" \
      -c "SELECT
        (SELECT count(*) FROM users),
        (SELECT count(*) FROM core_memories),
        (SELECT count(*) FROM diary_entries),
        (SELECT count(*) FROM tasks),
        (SELECT count(*) FROM user_settings);" \
      2>"${TEMP_DIR}/count_check.error"
  )"
  IFS='|' read -r USERS_COUNT MEMORY_COUNT DIARY_COUNT TASK_COUNT SETTINGS_COUNT \
    <<<"${RESTORED_COUNTS}"

  compare_count users "${USERS_COUNT}" "$(manifest_value users)"
  compare_count core_memories "${MEMORY_COUNT}" "$(manifest_value core_memories)"
  compare_count diary_entries "${DIARY_COUNT}" "$(manifest_value diary_entries)"
  compare_count tasks "${TASK_COUNT}" "$(manifest_value tasks)"
  compare_count user_settings "${SETTINGS_COUNT}" "$(manifest_value user_settings)"
else
  EXPECTED_TABLE_TOTAL="$(manifest_value table_count_total)"
  [[ "${EXPECTED_TABLE_TOTAL}" =~ ^[1-9][0-9]*$ ]] ||
    fail "the v2 manifest table count is invalid"

  EXPECTED_PUBLIC_TABLES="$(
    awk -F= '
      /^table_count\.[a-z][a-z0-9_]*=/ {
        key = $1
        sub(/^table_count\./, "", key)
        print key
      }
    ' "${TEMP_DIR}/manifest.txt" | LC_ALL=C sort
  )"
  ACTUAL_PUBLIC_TABLES="$(
    "${PSQL_BIN}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      --dbname="${TEMP_DATABASE_URL}" \
      -c "SELECT tablename
          FROM pg_catalog.pg_tables
          WHERE schemaname = 'public'
            AND tablename <> 'leilei_schema_migrations'
          ORDER BY tablename;" \
      2>"${TEMP_DIR}/table_inventory.error" |
    LC_ALL=C sort
  )"
  [[ "${ACTUAL_PUBLIC_TABLES}" == "${EXPECTED_PUBLIC_TABLES}" ]] ||
    fail "restored public table inventory does not match the backup manifest"

  VERIFIED_TABLES=0
  while IFS='=' read -r key expected; do
    case "${key}" in
      table_count.*) ;;
      *) continue ;;
    esac
    table="${key#table_count.}"
    [[ "${table}" =~ ^[a-z][a-z0-9_]{0,62}$ ]] ||
      fail "the v2 manifest contains an unsafe table identifier"
    [[ "${expected}" =~ ^[0-9]+$ ]] ||
      fail "the v2 manifest contains an invalid table count"
    if ! actual="$(
      "${PSQL_BIN}" \
        -X -A -t -v ON_ERROR_STOP=1 \
        --dbname="${TEMP_DATABASE_URL}" \
        -c "SELECT count(*) FROM public.\"${table}\";" \
        2>"${TEMP_DIR}/count_check.error"
    )"; then
      fail "a v2 manifest table is missing or unreadable after restore"
    fi
    [[ "${actual}" =~ ^[0-9]+$ ]] ||
      fail "restored table count is invalid"
    compare_count "${table}" "${actual}" "${expected}"
    VERIFIED_TABLES=$((VERIFIED_TABLES + 1))
  done <"${TEMP_DIR}/manifest.txt"

  [[ "${VERIFIED_TABLES}" -eq "${EXPECTED_TABLE_TOTAL}" ]] ||
    fail "the v2 manifest table-count inventory is incomplete"

  EXPECTED_MIGRATION_CREATED_AT="$(manifest_value migration_created_at)"
  EXPECTED_MIGRATION_HASH="$(manifest_value migration_hash)"
  [[ "${EXPECTED_MIGRATION_CREATED_AT}" =~ ^[0-9]+$ ]] ||
    fail "the v2 manifest migration timestamp is invalid"
  [[ "${EXPECTED_MIGRATION_HASH}" =~ ^[0-9a-f]{64}$ ]] ||
    fail "the v2 manifest migration hash is invalid"

  if ! RESTORED_MIGRATION_LEDGER="$(
    "${PSQL_BIN}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      --dbname="${TEMP_DATABASE_URL}" \
      -c "SELECT created_at::text || '|' || hash
          FROM public.leilei_schema_migrations
          ORDER BY created_at DESC
          LIMIT 1;" \
      2>"${TEMP_DIR}/migration_ledger.error"
  )"; then
    fail "the restored Leilei migration ledger could not be read"
  fi
  [[ "${RESTORED_MIGRATION_LEDGER}" == "${EXPECTED_MIGRATION_CREATED_AT}|${EXPECTED_MIGRATION_HASH}" ]] ||
    fail "the restored Leilei migration ledger does not match the backup"
  printf 'Leilei migration ledger verified: %s\n' \
    "${EXPECTED_MIGRATION_CREATED_AT}"
fi

EXPECTED_MAPPED_USERS="$(manifest_value mapped_user_count)"
if [[ "${EXPECTED_MAPPED_USERS}" != "-1" ]]; then
  [[ -n "${MCP_USER_ID:-}" ]] ||
    fail "MCP_USER_ID is required to verify the stored Auth0 user mapping"
  MAPPED_USERS="$(
    printf '%s\n' \
      "SELECT count(*) FROM users WHERE id = :'mcp_user_id'::uuid;" | \
      PGDATABASE="${TEMP_DATABASE_URL}" "${PSQL_BIN}" \
        -X -A -t -v ON_ERROR_STOP=1 \
        --set=mcp_user_id="${MCP_USER_ID}" \
        --dbname="${TEMP_DATABASE_URL}" \
        2>"${TEMP_DIR}/mapping_check.error"
  )"
  if [[ "${MAPPED_USERS}" != "${EXPECTED_MAPPED_USERS}" ]]; then
    printf 'Auth0 mapped-user count mismatch.\n' >&2
    MISMATCHES=$((MISMATCHES + 1))
  else
    printf 'Auth0 mapped-user count verified.\n'
  fi
else
  printf 'Auth0 mapped-user verification unavailable in source manifest.\n'
fi

[[ "${MISMATCHES}" -eq 0 ]] ||
  fail "${MISMATCHES} restored count checks did not match"

printf 'Temporary restore verification succeeded.\n'
