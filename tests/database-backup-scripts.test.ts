import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const backupScript = join(repoRoot, "scripts/db/backup_postgres.sh");
const restoreScript = join(repoRoot, "scripts/db/restore_verify_postgres.sh");

function run(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync("bash", [script], {
    cwd: repoRoot,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: "utf8",
  });
}

function createFakePostgresTools(root: string) {
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
if [[ "$query" == *"to_regclass"* ]]; then
  printf 't|t|t|t|t\\n'
elif [[ "$query" == *"server_version_num"* ]]; then
  printf '180001\\n'
elif [[ "$query" == *"WHERE id"* ]]; then
  printf '1\\n'
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
  assert.match(backupFile, /_\d{8}T\d{6}Z_0009_soft_master_chief\.backup\.enc$/);
  assert.equal(readFileSync(`${backupFile}.sha256`, "utf8").split(/\s+/)[0].length, 64);

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
});

test("gitignore covers common database backup artifacts", () => {
  const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8");
  for (const pattern of ["*.dump", "*.backup", "*.backup.enc", "*.sha256"]) {
    assert.ok(gitignore.includes(pattern), `missing ${pattern}`);
  }
});
