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
