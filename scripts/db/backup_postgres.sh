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
require_command node
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

READINESS_MAX_ATTEMPTS="${LEILEI_BACKUP_READINESS_MAX_ATTEMPTS:-12}"
READINESS_DELAY_SECONDS="${LEILEI_BACKUP_READINESS_DELAY_SECONDS:-2}"
[[ "${READINESS_MAX_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]] ||
  fail "LEILEI_BACKUP_READINESS_MAX_ATTEMPTS must be a positive integer"
[[ "${READINESS_DELAY_SECONDS}" =~ ^[0-9]+$ ]] ||
  fail "LEILEI_BACKUP_READINESS_DELAY_SECONDS must be a non-negative integer"

SERVER_VERSION_NUM=""
for (( attempt = 1; attempt <= READINESS_MAX_ATTEMPTS; attempt += 1 )); do
  if SERVER_VERSION_NUM="$(
    "${PSQL_BIN}" "${DATABASE_URL}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      -c "SHOW server_version_num;" \
      2>/dev/null
  )" && [[ "${SERVER_VERSION_NUM}" =~ ^[0-9]+$ ]]; then
    break
  fi
  SERVER_VERSION_NUM=""
  if (( attempt < READINESS_MAX_ATTEMPTS )); then
    sleep "${READINESS_DELAY_SECONDS}"
  fi
done
[[ "${SERVER_VERSION_NUM}" =~ ^[0-9]+$ ]] ||
  fail "PostgreSQL server version could not be verified after bounded readiness retries"
SERVER_MAJOR="$((SERVER_VERSION_NUM / 10000))"
[[ "${PG_DUMP_MAJOR}" -ge "${SERVER_MAJOR}" ]] ||
  fail "pg_dump must not be older than the PostgreSQL server"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/leilei-backup.XXXXXX")"
DUMP_PATH="${TEMP_DIR}/database.dump"
MANIFEST_PATH="${TEMP_DIR}/manifest.txt"
ARCHIVE_PATH="${TEMP_DIR}/backup.tar.gz"
FINAL_TEMP=""
CHECKSUM_TEMP=""

cleanup() {
  unset LEILEI_BACKUP_PASSPHRASE
  [[ -z "${FINAL_TEMP}" ]] || rm -f "${FINAL_TEMP}"
  [[ -z "${CHECKSUM_TEMP}" ]] || rm -f "${CHECKSUM_TEMP}"
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT HUP INT TERM

if ! MIGRATION_LEDGER="$(
  "${PSQL_BIN}" "${DATABASE_URL}" \
    -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT created_at::text || '|' || hash
        FROM public.leilei_schema_migrations
        ORDER BY created_at DESC
        LIMIT 1;" \
    2>"${TEMP_DIR}/migration_ledger.error"
)"; then
  fail "Leilei migration ledger could not be read"
fi

IFS='|' read -r MIGRATION_CREATED_AT MIGRATION_HASH <<<"${MIGRATION_LEDGER}"
[[ "${MIGRATION_CREATED_AT}" =~ ^[0-9]+$ ]] ||
  fail "Leilei migration ledger timestamp is invalid"
[[ "${MIGRATION_HASH}" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Leilei migration ledger hash is invalid"

SCHEMA_VERSION="$(
  node --input-type=commonjs - \
    "${REPO_ROOT}/drizzle/meta/_journal.json" \
    "${MIGRATION_CREATED_AT}" <<'NODE'
const fs = require("node:fs");
const [journalPath, createdAt] = process.argv.slice(2);
const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entry = journal.entries?.find(
  (candidate) => String(candidate.when) === createdAt,
);
if (!entry || typeof entry.tag !== "string") process.exit(2);
process.stdout.write(entry.tag);
NODE
)" || fail "production migration head is not represented in the checked-in Drizzle journal"
[[ "${SCHEMA_VERSION}" =~ ^[0-9]{4}_[A-Za-z0-9_]+$ ]] ||
  fail "schema version resolved from the migration ledger is invalid"

UTC_TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
BASE_NAME="leilei-os_${UTC_TIMESTAMP}_${SCHEMA_VERSION}.backup.enc"
FINAL_PATH="${OUTPUT_DIR}/${BASE_NAME}"
CHECKSUM_PATH="${FINAL_PATH}.sha256"
FINAL_TEMP="${FINAL_PATH}.tmp"
CHECKSUM_TEMP="${CHECKSUM_PATH}.tmp"

[[ ! -e "${FINAL_PATH}" && ! -e "${CHECKSUM_PATH}" ]] ||
  fail "the destination backup or checksum already exists"

if ! "${PG_DUMP_BIN}" "${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${DUMP_PATH}" \
  2>"${TEMP_DIR}/pg_dump.error"; then
  fail "pg_dump failed; sensitive connection details were suppressed"
fi

if ! PUBLIC_TABLES="$(
  "${PSQL_BIN}" "${DATABASE_URL}" \
    -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT tablename
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename <> 'leilei_schema_migrations'
        ORDER BY tablename;" \
    2>"${TEMP_DIR}/table_list.error"
)"; then
  fail "public table inventory could not be read"
fi
[[ -n "${PUBLIC_TABLES}" ]] ||
  fail "public table inventory is empty"

TABLE_COUNT_LINES=""
TABLE_COUNT_TOTAL=0
while IFS= read -r table; do
  [[ -n "${table}" ]] || continue
  [[ "${table}" =~ ^[a-z][a-z0-9_]{0,62}$ ]] ||
    fail "public table inventory contained an unsafe identifier"
  if ! count="$(
    "${PSQL_BIN}" "${DATABASE_URL}" \
      -X -A -t -v ON_ERROR_STOP=1 \
      -c "SELECT count(*) FROM public.\"${table}\";" \
      2>"${TEMP_DIR}/table_count.error"
  )"; then
    fail "record-count verification failed; sensitive details were suppressed"
  fi
  [[ "${count}" =~ ^[0-9]+$ ]] ||
    fail "record-count verification returned an invalid value"
  TABLE_COUNT_LINES+="table_count.${table}=${count}"$'\n'
  TABLE_COUNT_TOTAL=$((TABLE_COUNT_TOTAL + 1))
done <<<"${PUBLIC_TABLES}"
[[ "${TABLE_COUNT_TOTAL}" -gt 0 ]] ||
  fail "no public table counts were captured"

MAPPED_USER_COUNT="-1"
if [[ -n "${MCP_USER_ID:-}" ]]; then
  if ! MAPPED_USER_COUNT="$(
    printf '%s\n' \
      "SELECT count(*) FROM users WHERE id = :'mcp_user_id'::uuid;" | \
      "${PSQL_BIN}" "${DATABASE_URL}" \
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
format=leilei-os-postgres-backup-v2
created_at_utc=${UTC_TIMESTAMP}
schema_version=${SCHEMA_VERSION}
postgres_server_major=${SERVER_MAJOR}
pg_dump_major=${PG_DUMP_MAJOR}
migration_created_at=${MIGRATION_CREATED_AT}
migration_hash=${MIGRATION_HASH}
mapped_user_count=${MAPPED_USER_COUNT}
table_count_total=${TABLE_COUNT_TOTAL}
EOF
printf '%s' "${TABLE_COUNT_LINES}" >>"${MANIFEST_PATH}"

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
