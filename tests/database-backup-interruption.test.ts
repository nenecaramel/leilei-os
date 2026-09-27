import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const backupScript = join(repoRoot, "scripts/db/backup_postgres.sh");

function currentMigrationWhen(): string {
  const journal = JSON.parse(
    readFileSync(
      join(repoRoot, "drizzle/meta/_journal.json"),
      "utf8",
    ),
  ) as {
    entries?: Array<{ when?: number }>;
  };
  const latest = journal.entries?.at(-1);
  assert.equal(typeof latest?.when, "number");
  return String(latest!.when);
}

test("SIGTERM cleans temporary plaintext backup material", async () => {
  const migrationWhen = currentMigrationWhen();
  const temp = mkdtempSync(join(tmpdir(), "leilei-backup-interrupt-"));
  const bin = join(temp, "bin");
  const scratch = join(temp, "scratch");
  const output = join(temp, "external");
  const started = join(temp, "pg-dump-started");
  mkdirSync(bin);
  mkdirSync(scratch);

  writeFileSync(
    join(bin, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
query=""
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "-c" ]]; then shift; query="$1"; fi
  shift || true
done
if [[ "$query" == *"server_version_num"* ]]; then
  printf '180001\\n'
elif [[ "$query" == *"leilei_schema_migrations"* ]]; then
  printf '${migrationWhen}|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n'
else
  printf '1\\n'
fi
`,
    { mode: 0o700 },
  );
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
printf 'temporary plaintext' > "$output"
touch "$FAKE_STARTED_FILE"
trap 'exit 130' INT TERM
while true; do sleep 1; done
`,
    { mode: 0o700 },
  );

  let stderr = "";
  const child = spawn("bash", [backupScript], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      TMPDIR: scratch,
      DATABASE_URL: "postgresql://placeholder.invalid/source",
      LEILEI_BACKUP_DIR: output,
      LEILEI_BACKUP_PASSPHRASE: "test-passphrase-long-enough",
      FAKE_STARTED_FILE: started,
    },
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    for (
      let attempt = 0;
      attempt < 250 && !existsSync(started);
      attempt += 1
    ) {
      await delay(20);
    }
    assert.ok(existsSync(started), `fake pg_dump did not start: ${stderr}`);
    process.kill(-child.pid!, "SIGTERM");
    await Promise.race([
      new Promise<void>((resolveClose) =>
        child.once("close", () => resolveClose()),
      ),
      delay(3_000).then(() => assert.fail("backup process did not stop")),
    ]);
    assert.deepEqual(readdirSync(scratch), []);
  } finally {
    if (child.exitCode === null && child.pid) {
      process.kill(-child.pid, "SIGKILL");
    }
  }
});
