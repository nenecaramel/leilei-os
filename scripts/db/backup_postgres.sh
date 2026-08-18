#!/usr/bin/env bash
set -euo pipefail

umask 077

fail() {
  printf 'Backup refused: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    fail "required command '$1' is not installed"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
OUTPUT_DIR="${LEILEI_BACKUP_DIR:-${HOME}/leilei-os-backups}"
PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
PSQL_BIN="${PSQL_BIN:-psql}"
OPENSSL_BIN="${OPENSSL_BIN:-openssl}"

[[ -n "${DATABASE_URL:-}" ]] ||
  fail "DATABASE_URL is required"

if [[ "${OUTPUT_DIR}" == /* ]]; then
  OUTPUT_CANDIDATE="${OUTPUT_DIR}"
else
  OUTPUT_CANDIDATE="$(pwd -P)/${OUTPUT_DIR}"
fi
case "${OUTPUT_CANDIDATE}/" in
  "${REPO_ROOT}/"*)
    fail "the backup directory must be outside the Git repository"
    ;;
esac

mkdir -p "${OUTPUT_DIR}"
chmod 700 "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd -P)"

case "${OUTPUT_DIR}/" in
  "${REPO_ROOT}/"*)
    fail "the backup directory must be outside the Git repository"
    ;;
esac

require_command "${PG_DUMP_BIN}"
require_command "${PSQL_BIN}"
require_command "${OPENSSL_BIN}"
require_command tar
require_command shasum

if [[ -z "${LEILEI_BACKUP_PASSPHRASE:-}" ]]; then
  if [[ -t 0 ]]; then
    read -r -s -p "Backup encryption passphrase: " LEILEI_BACKUP_PASSPHRASE
    printf '\n' >&2
    export LEILEI_BACKUP_PASSPHRASE
  else
    fail "LEILEI_BACKUP_PASSPHRASE is required in non-interactive mode"
  fi
fi

[[ "${#LEILEI_BACKUP_PASSPHRASE}" -ge 16 ]] ||
  fail "the encryption passphrase must contain at least 16 characters"

PG_DUMP_MAJOR="$(
  "${PG_DUMP_BIN}" --version |
    awk '{for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+(\.[0-9]+)*$/) {split($i, v, "."); print v[1]; exit}}'
)"
[[ "${PG_DUMP_MAJOR}" =~ ^[0-9]+$ ]] ||
  fail "pg_dump version could not be determined"

if ! SERVER_VERSION_NUM="$(
  PGDATABASE="${DATABASE_URL}" "${PSQL_BIN}" \
    -X -A -t -v ON_ERROR_STOP=1 \
    -c "SHOW server_version_num;" \
    2>/dev/null
)"; then
  fail "PostgreSQL server version could not be verified"
fi
[[ "${SERVER_VERSION_NUM}" =~ ^[0-9]+$ ]] ||
  fail "PostgreSQL server version is invalid"
SERVER_MAJOR="$((SERVER_VERSION_NUM / 10000))"
[[ "${PG_DUMP_MAJOR}" -ge "${SERVER_MAJOR}" ]] ||
  fail "pg_dump must not be older than the PostgreSQL server"

SCHEMA_VERSION="$(
  find "${REPO_ROOT}/drizzle" -maxdepth 1 -type f \
    -name '[0-9][0-9][0-9][0-9]_*.sql' \
    -exec basename {} .sql \; |
    LC_ALL=C sort |
    tail -n 1
)"
[[ -n "${SCHEMA_VERSION}" ]] ||
  fail "schema version could not be determined from drizzle migrations"

UTC_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
BASE_NAME="leilei-os_${UTC_TIMESTAMP}_${SCHEMA_VERSION}.backup.enc"
FINAL_PATH="${OUTPUT_DIR}/${BASE_NAME}"
CHECKSUM_PATH="${FINAL_PATH}.sha256"

[[ ! -e "${FINAL_PATH}" && ! -e "${CHECKSUM_PATH}" ]] ||
  fail "the destination backup or checksum already exists"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/leilei-backup.XXXXXX")"
DUMP_PATH="${TEMP_DIR}/database.dump"
MANIFEST_PATH="${TEMP_DIR}/manifest.txt"
ARCHIVE_PATH="${TEMP_DIR}/backup.tar.gz"
FINAL_TEMP="${FINAL_PATH}.tmp"
CHECKSUM_TEMP="${CHECKSUM_PATH}.tmp"

cleanup() {
  unset LEILEI_BACKUP_PASSPHRASE
  rm -f "${FINAL_TEMP}" "${CHECKSUM_TEMP}"
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT HUP INT TERM

if ! PGDATABASE="${DATABASE_URL}" "${PG_DUMP_BIN}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${DUMP_PATH}" \
  2>"${TEMP_DIR}/pg_dump.error"; then
  fail "pg_dump failed; sensitive connection details were suppressed"
fi

if ! COUNTS="$(
  PGDATABASE="${DATABASE_URL}" "${PSQL_BIN}" \
    -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT
      (SELECT count(*) FROM users),
      (SELECT count(*) FROM core_memories),
      (SELECT count(*) FROM diary_entries),
      (SELECT count(*) FROM tasks),
      (SELECT count(*) FROM user_settings);" \
    2>"${TEMP_DIR}/psql.error"
)"; then
  fail "record-count verification failed; sensitive details were suppressed"
fi

IFS='|' read -r USERS_COUNT MEMORY_COUNT DIARY_COUNT TASK_COUNT SETTINGS_COUNT \
  <<<"${COUNTS}"

for value in \
  "${USERS_COUNT}" \
  "${MEMORY_COUNT}" \
  "${DIARY_COUNT}" \
  "${TASK_COUNT}" \
  "${SETTINGS_COUNT}"; do
  [[ "${value}" =~ ^[0-9]+$ ]] ||
    fail "record-count verification returned an invalid value"
done

MAPPED_USER_COUNT="-1"
if [[ -n "${MCP_USER_ID:-}" ]]; then
  if ! MAPPED_USER_COUNT="$(
    printf '%s\n' \
      "SELECT count(*) FROM users WHERE id = :'mcp_user_id'::uuid;" | \
      PGDATABASE="${DATABASE_URL}" "${PSQL_BIN}" \
        -X -A -t -v ON_ERROR_STOP=1 \
        --set=mcp_user_id="${MCP_USER_ID}" \
        2>"${TEMP_DIR}/mapping.error"
  )"; then
    fail "Auth0 user mapping verification failed"
  fi
  [[ "${MAPPED_USER_COUNT}" =~ ^[0-9]+$ ]] ||
    fail "Auth0 user mapping verification returned an invalid value"
fi

cat >"${MANIFEST_PATH}" <<EOF
format=leilei-os-postgres-backup-v1
created_at_utc=${UTC_TIMESTAMP}
schema_version=${SCHEMA_VERSION}
postgres_server_major=${SERVER_MAJOR}
pg_dump_major=${PG_DUMP_MAJOR}
users=${USERS_COUNT}
core_memories=${MEMORY_COUNT}
diary_entries=${DIARY_COUNT}
tasks=${TASK_COUNT}
user_settings=${SETTINGS_COUNT}
mapped_user_count=${MAPPED_USER_COUNT}
EOF

tar -C "${TEMP_DIR}" -czf "${ARCHIVE_PATH}" database.dump manifest.txt

if ! "${OPENSSL_BIN}" enc \
  -aes-256-cbc \
  -pbkdf2 \
  -iter 200000 \
  -salt \
  -pass env:LEILEI_BACKUP_PASSPHRASE \
  -in "${ARCHIVE_PATH}" \
  -out "${FINAL_TEMP}" \
  2>"${TEMP_DIR}/openssl.error"; then
  fail "backup encryption failed"
fi

FILE_HASH="$(shasum -a 256 "${FINAL_TEMP}" | awk '{print $1}')"
[[ "${FILE_HASH}" =~ ^[0-9a-f]{64}$ ]] ||
  fail "SHA-256 generation failed"
printf '%s  %s\n' "${FILE_HASH}" "${BASE_NAME}" >"${CHECKSUM_TEMP}"
mv "${FINAL_TEMP}" "${FINAL_PATH}"
mv "${CHECKSUM_TEMP}" "${CHECKSUM_PATH}"

printf 'Encrypted backup created: %s\n' "${FINAL_PATH}"
printf 'SHA-256 file created: %s\n' "${CHECKSUM_PATH}"
