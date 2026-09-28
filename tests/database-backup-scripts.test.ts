import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const backupScript = join(repoRoot, "scripts/db/backup_postgres.sh");
const restoreScript = join(repoRoot, "scripts/db/restore_verify_postgres.sh");

function currentMigrationHead(): string {
  const migration = readdirSync(join(repoRoot, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .at(-1);
  assert.ok(migration, "expected at least one Drizzle migration");
  return migration.slice(0, -".sql".length);
}

function currentMigrationWhen(): string {
  const journal = JSON.parse(
    readFileSync(
      join(repoRoot, "drizzle/meta/_journal.json"),
      "utf8",
    ),
  ) as {
    entries?: Array<{ when?: number; tag?: string }>;
  };
  const latest = journal.entries?.at(-1);
  assert.equal(latest?.tag, currentMigrationHead());
  assert.equal(typeof latest?.when, "number");
  return String(latest!.when);
}

function run(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [script], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: "utf8",
  });
}

function createFakePostgresTools(root: string) {
  const migrationWhen = currentMigrationWhen();
  const migrationHash = "a".repeat(64);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "pg_dump"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'pg_dump (PostgreSQL) 18.1\\n'
  exit 0
fi
for arg in "$@"; do
  case "$arg" in --file=*) output="\${arg#--file=}" ;; esac
done
printf 'fake custom dump' > "$output"
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
query=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-c" ]]; then shift; query="$1"; fi
  shift || true
done
if [[ -z "$query" && ! -t 0 ]]; then
  query="$(cat)"
fi
if [[ "$query" == *"server_version_num"* ]]; then
  printf '180001\\n'
elif [[ "$query" == *"leilei_schema_migrations"* ]]; then
  printf '${migrationWhen}|${migrationHash}\\n'
elif [[ "$query" == *"pg_catalog.pg_tables"* ]]; then
  printf '%s\\n' \\
    conversations \\
    diary_entries \\
    health_daily_summaries \\
    project_workspaces \\
    runtime_subject_states \\
    todo_papers \\
    universe_meta \\
    users
elif [[ "$query" == *'SELECT count(*) FROM public."'* ]]; then
  printf '1\\n'
elif [[ "$query" == *"WHERE id"* ]]; then
  printf '1\\n'
elif [[ "$query" == *"to_regclass"* ]]; then
  printf 't|t|t|t|t\\n'
else
  printf '1|7|7|7|1\\n'
fi
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "pg_restore"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'pg_restore (PostgreSQL) 18.1\\n'
  exit 0
fi
found_dbname=false
for arg in "$@"; do
  [[ "$arg" == --dbname=* ]] && found_dbname=true
done
[[ "$found_dbname" == true ]]
exit 0
`,
    { mode: 0o700 },
  );
  return bin;
}

test("database backup scripts parse as Bash", () => {
  for (const script of [backupScript, restoreScript]) {
    const result = spawnSync("bash", ["-n", script], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("backup refuses to run without DATABASE_URL", () => {
  const result = run(backupScript, {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL is required/);
});

test("backup refuses an output directory inside the repository", () => {
  const result = run(backupScript, {
    DATABASE_URL: "postgresql://placeholder.invalid/db",
    LEILEI_BACKUP_DIR: join(repoRoot, "unsafe-backups"),
    LEILEI_BACKUP_PASSPHRASE: "test-passphrase-long-enough",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the Git repository/);
});

test("restore fails closed without explicit temporary restore flags", () => {
  const result = run(restoreScript, {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LEILEI_ALLOW_TEMP_RESTORE=1/);
});

test("restore refuses remote and ambiguously named targets", () => {
  const temp = mkdtempSync(join(tmpdir(), "leilei-restore-refuse-"));
  const backup = join(temp, "sample.backup.enc");
  writeFileSync(backup, "not-used");
  const result = run(restoreScript, {
    LEILEI_ALLOW_TEMP_RESTORE: "1",
    LEILEI_RESTORE_TARGET_ENV: "temporary",
    TEMP_DATABASE_URL: "postgresql://example.invalid/restore_temp",
    BACKUP_FILE: backup,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only an explicitly named local/);
});

test("backup tolerates bounded source readiness failures before succeeding", () => {
  const temp = mkdtempSync(join(tmpdir(), "leilei-backup-readiness-"));
  const fakeBin = createFakePostgresTools(temp);
  const attempts = join(temp, "readiness-attempts");
  const migrationWhen = currentMigrationWhen();
  writeFileSync(
    join(fakeBin, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
query=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-c" ]]; then shift; query="$1"; fi
  shift || true
done
if [[ -z "$query" && ! -t 0 ]]; then
  query="$(cat)"
fi
if [[ "$query" == *"server_version_num"* ]]; then
  count=0
  [[ ! -f "$FAKE_READINESS_FILE" ]] || count="$(cat "$FAKE_READINESS_FILE")"
  count=$((count + 1))
  printf '%s' "$count" > "$FAKE_READINESS_FILE"
  if [[ "$count" -lt 3 ]]; then exit 1; fi
  printf '180001\\n'
elif [[ "$query" == *"leilei_schema_migrations"* ]]; then
  printf '${migrationWhen}|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n'
elif [[ "$query" == *"pg_catalog.pg_tables"* ]]; then
  printf 'users\\n'
elif [[ "$query" == *'SELECT count(*) FROM public."'* ]]; then
  printf '1\\n'
else
  printf '1\\n'
fi
`,
    { mode: 0o700 },
  );

  const result = run(backupScript, {
    PATH: fakeBin + ":" + process.env.PATH,
    DATABASE_URL: "postgresql://placeholder.invalid/source",
    LEILEI_BACKUP_DIR: join(temp, "external"),
    LEILEI_BACKUP_PASSPHRASE: "test-passphrase-long-enough",
    LEILEI_BACKUP_READINESS_MAX_ATTEMPTS: "3",
    LEILEI_BACKUP_READINESS_DELAY_SECONDS: "0",
    FAKE_READINESS_FILE: attempts,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(attempts, "utf8"), "3");
});

test("backup refuses pg_dump older than the production server", () => {
  const temp = mkdtempSync(join(tmpdir(), "leilei-backup-version-"));
  const fakeBin = createFakePostgresTools(temp);
  writeFileSync(
    join(fakeBin, "pg_dump"),
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  printf 'pg_dump (PostgreSQL) 17.9\\n'
  exit 0
fi
exit 99
`,
    { mode: 0o700 },
  );
  const result = run(backupScript, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    DATABASE_URL: "postgresql://placeholder.invalid/source",
    LEILEI_BACKUP_DIR: join(temp, "external"),
    LEILEI_BACKUP_PASSPHRASE: "test-passphrase-long-enough",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be older/);
});

test("encrypted backup and local temporary restore verification work with fake PostgreSQL tools", () => {
  const temp = mkdtempSync(join(tmpdir(), "leilei-backup-test-"));
  const output = join(temp, "external");
  const fakeBin = createFakePostgresTools(temp);
  const path = `${fakeBin}:${process.env.PATH}`;
  const shared = {
    PATH: path,
    LEILEI_BACKUP_PASSPHRASE: "test-passphrase-long-enough",
    MCP_USER_ID: "11111111-1111-4111-8111-111111111111",
  };
  const backup = run(backupScript, {
    ...shared,
    DATABASE_URL: "postgresql://placeholder.invalid/source",
    LEILEI_BACKUP_DIR: output,
  });
  assert.equal(backup.status, 0, backup.stderr);
  const match = backup.stdout.match(/Encrypted backup created: (.+)/);
  assert.ok(match);
  const backupFile = match[1].trim();
  assert.match(backupFile, /_\d{8}T\d{6}Z_/);
  assert.ok(backupFile.endsWith(`_${currentMigrationHead()}.backup.enc`));
  assert.equal(readFileSync(`${backupFile}.sha256`, "utf8").split(/\s+/)[0].length, 64);
  assert.match(currentMigrationWhen(), /^[0-9]+$/);

  const backupSource = readFileSync(backupScript, "utf8");
  assert.match(backupSource, /leilei-os-postgres-backup-v2/);
  assert.match(backupSource, /pg_catalog\.pg_tables/);
  assert.match(backupSource, /leilei_schema_migrations/);
  assert.doesNotMatch(
    backupSource,
    /SELECT\s+\(SELECT count\(\*\) FROM core_memories\)/,
  );
  assert.doesNotMatch(
    backupSource,
    /SELECT\s+\(SELECT count\(\*\) FROM tasks\)/,
  );

  const restore = run(restoreScript, {
    ...shared,
    LEILEI_ALLOW_TEMP_RESTORE: "1",
    LEILEI_RESTORE_TARGET_ENV: "temporary",
    TEMP_DATABASE_URL: "postgresql://127.0.0.1/leilei_restore_verify",
    BACKUP_FILE: backupFile,
  });
  assert.equal(restore.status, 0, restore.stderr);
  assert.match(restore.stdout, /Temporary restore verification succeeded/);
  assert.match(restore.stdout, /Auth0 mapped-user count verified/);
  assert.match(restore.stdout, /Leilei migration ledger verified/);
  assert.match(restore.stdout, /runtime_subject_states count verified: 1/);
});

test("restore remains compatible with historical v1 backup manifests", () => {
  const temp = mkdtempSync(join(tmpdir(), "leilei-backup-v1-"));
  const payload = join(temp, "payload");
  const archive = join(temp, "legacy.tar.gz");
  const backupFile = join(temp, "legacy.backup.enc");
  const checksumFile = `${backupFile}.sha256`;
  const fakeBin = createFakePostgresTools(temp);
  mkdirSync(payload);
  writeFileSync(join(payload, "database.dump"), "fake custom dump");
  writeFileSync(
    join(payload, "manifest.txt"),
    [
      "format=leilei-os-postgres-backup-v1",
      "created_at_utc=20260728T041029Z",
      "schema_version=0006_large_chat",
      "postgres_server_major=18",
      "pg_dump_major=18",
      "users=1",
      "core_memories=7",
      "diary_entries=7",
      "tasks=7",
      "user_settings=1",
      "mapped_user_count=1",
      "",
    ].join("\n"),
  );
  execFileSync("tar", [
    "-C",
    payload,
    "-czf",
    archive,
    "database.dump",
    "manifest.txt",
  ]);
  execFileSync("openssl", [
    "enc",
    "-aes-256-cbc",
    "-pbkdf2",
    "-iter",
    "200000",
    "-salt",
    "-pass",
    "pass:test-passphrase-long-enough",
    "-in",
    archive,
    "-out",
    backupFile,
  ]);
  const checksum = execFileSync(
    "shasum",
    ["-a", "256", backupFile],
    { encoding: "utf8" },
  ).split(/\s+/)[0];
  writeFileSync(
    checksumFile,
    `${checksum}  ${backupFile.split("/").at(-1)}\n`,
  );

  const restore = run(restoreScript, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    LEILEI_ALLOW_TEMP_RESTORE: "1",
    LEILEI_RESTORE_TARGET_ENV: "temporary",
    TEMP_DATABASE_URL:
      "postgresql://127.0.0.1/leilei_restore_verify_v1",
    BACKUP_FILE: backupFile,
    LEILEI_BACKUP_PASSPHRASE:
      "test-passphrase-long-enough",
    MCP_USER_ID:
      "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(restore.status, 0, restore.stderr);
  assert.match(
    restore.stdout,
    /Temporary restore verification succeeded/,
  );
  assert.match(
    restore.stdout,
    /core_memories count verified: 7/,
  );
});

test("gitignore covers common database backup artifacts", () => {
  const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
  for (const pattern of ["*.dump", "*.backup", "*.backup.enc", "*.sha256"]) {
    assert.ok(gitignore.includes(pattern), `missing ${pattern}`);
  }
});
