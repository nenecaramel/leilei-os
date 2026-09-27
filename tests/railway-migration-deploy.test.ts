import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Railway config runs the compiled database migrator before deploy", () => {
  const configUrl = new URL("../railway.json", import.meta.url);
  assert.equal(existsSync(configUrl), true, "railway.json must exist");

  const config = JSON.parse(readFileSync(configUrl, "utf8")) as {
    build?: { builder?: string; dockerfilePath?: string };
    deploy?: { preDeployCommand?: string };
  };

  assert.equal(config.build?.builder, "DOCKERFILE");
  assert.equal(config.build?.dockerfilePath, "Dockerfile");
  assert.equal(config.deploy?.preDeployCommand, "node dist/database/migrate.js");
});

test("runtime image contains checked-in Drizzle migrations", () => {
  const dockerfile = readRepoFile("Dockerfile");
  assert.match(dockerfile, /COPY\s+drizzle\s+\.\/drizzle/);
});

test("production migration entrypoint uses the compatible LeileiOS ledger", () => {
  const migrateUrl = new URL("../src/database/migrate.ts", import.meta.url);
  assert.equal(existsSync(migrateUrl), true, "src/database/migrate.ts must exist");

  const source = readFileSync(migrateUrl, "utf8");
  assert.match(source, /drizzle-orm\/migrator/);
  assert.doesNotMatch(source, /postgres-js\/migrator/);
  assert.match(source, /readMigrationFiles/);
  assert.match(source, /leilei_schema_migrations/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /resolveRailwayMigrationDatabaseUrl/);
  assert.match(source, /RAILWAY_ENVIRONMENT_ID/);
  assert.match(source, /to_regclass\('public\.data_import_runs'\)/);
  assert.match(source, /DATABASE_URL/);
});

test("migration ledger bootstrap commits separately from schema advancement", () => {
  const source = readRepoFile("src/database/migrate.ts");
  const transactionCount = source.match(/await client\.begin\(/g)?.length ?? 0;
  assert.equal(
    transactionCount,
    2,
    "migration runner must use separate bootstrap and schema-advance transactions",
  );
});

test("pending migration ledger row is written before its SQL inside the same transaction", () => {
  const source = readRepoFile("src/database/migrate.ts");
  const pendingLoop = source.indexOf("for (const migration of pending)");
  assert.notEqual(pendingLoop, -1, "pending migration loop must exist");

  const ledgerInsert = source.indexOf(
    "insert into public.leilei_schema_migrations (created_at, hash)",
    pendingLoop,
  );
  const sqlExecution = source.indexOf("await transaction.unsafe(statement)", pendingLoop);

  assert.notEqual(ledgerInsert, -1, "pending migration ledger insert must exist");
  assert.notEqual(sqlExecution, -1, "pending migration SQL execution must exist");
  assert.ok(
    ledgerInsert < sqlExecution,
    "pending migration ledger row must be recorded before its SQL within the transaction",
  );
});

test("migration emits safe network diagnostics before opening the migration client", () => {
  const source = readRepoFile("src/database/migrate.ts");
  const diagnostics = source.indexOf("collectMigrationNetworkDiagnostics(");
  const client = source.indexOf("const client = postgres(");
  assert.notEqual(diagnostics, -1, "migration must collect network diagnostics");
  assert.notEqual(client, -1, "migration must create the postgres client");
  assert.ok(diagnostics < client, "network diagnostics must run before the migration client is created");
  assert.match(source, /MIGRATION_NETWORK_DIAGNOSTICS=UNAVAILABLE/);
});

test("migration readiness runs before bootstrap and uses the same single-client query", () => {
  const source = readRepoFile("src/database/migrate.ts");
  const readiness = source.indexOf("waitForMigrationDatabaseReady(");
  const client = source.indexOf("const client = postgres(");
  const firstTransaction = source.indexOf("await client.begin(");
  assert.notEqual(readiness, -1, "migration must run a readiness check");
  assert.notEqual(client, -1, "migration must create the postgres client");
  assert.ok(client < readiness, "readiness must use the created migration client");
  assert.ok(readiness < firstTransaction, "readiness must precede every migration transaction");
  assert.match(source, /migrationStage = "readiness"/);
  assert.match(source, /client`select 1`/);
  assert.match(source, /max: 1/);
});

test("migration readiness does not wrap or retry the existing transactions", () => {
  const source = readRepoFile("src/database/migrate.ts");
  const readiness = source.indexOf("waitForMigrationDatabaseReady(");
  const firstTransaction = source.indexOf("await client.begin(");
  assert.equal((source.match(/await client\.begin\(/g) ?? []).length, 2);
  assert.ok(readiness < firstTransaction);
  assert.doesNotMatch(source.slice(firstTransaction), /waitForMigrationDatabaseReady/);
});

test("migration success exposes a safe exact checked-in-head verification marker", () => {
  const source = readRepoFile("src/database/migrate.ts");
  assert.match(
    source,
    /MIGRATION_LEDGER_HEAD_MATCH=YES created_at=/,
  );
  assert.doesNotMatch(
    source,
    /MIGRATION_LEDGER_HEAD_MATCH=YES[^\n]*hash=/,
  );
});

test("migration failure logs expose only a controlled stage and safe error fingerprint", () => {
  const source = readRepoFile("src/database/migrate.ts");

  assert.match(source, /let migrationStage =/);
  assert.match(source, /function safeErrorName\(/);
  assert.match(source, /function safeErrorCode\(/);
  assert.match(
    source,
    /Database migration failed\. stage=\$\{migrationStage\} name=\$\{safeErrorName\(error\)\} code=\$\{safeErrorCode\(error\)\}/,
  );
  assert.doesNotMatch(source, /console\.error\(error/);
  assert.doesNotMatch(source, /error\.message/);
  assert.doesNotMatch(source, /error\.stack/);
  assert.doesNotMatch(source, /DATABASE_URL[^\n]*console\.error/);
});
