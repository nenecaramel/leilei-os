import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

type RailwaySpec = {
  resources: Array<{
    address: string;
    build?: { builder?: string; dockerfilePath?: string; watchPatterns?: string[] };
    deploy?: Record<string, unknown>;
    variables?: Record<string, unknown>;
  }>;
};

async function railwaySpec(): Promise<RailwaySpec> {
  const { default: define } = await import("../.railway/railway.ts");
  return await (define as (ctx: unknown) => RailwaySpec | Promise<RailwaySpec>)({
    command: "plan",
    environment: "production",
    environmentName: "production",
    isEnvironment: (name: string) => name === "production",
  });
}

test("Railway IaC keeps the Dockerfile build, migration pre-deploy and readiness gate", async () => {
  // Config as Code stops being read on 2026-12-01; a leftover file would also
  // block `railway config plan` from managing the service.
  for (const legacy of ["railway.json", "railway.toml", "railway.wake-broker.json"]) {
    assert.equal(existsSync(new URL(`../${legacy}`, import.meta.url)), false, `${legacy} must be retired`);
  }
  const spec = await railwaySpec();
  const server = spec.resources.find((resource) => resource.address === "service.leilei-os");
  assert.ok(server);
  assert.equal(server.build?.builder, "DOCKERFILE");
  assert.equal(server.build?.dockerfilePath, "Dockerfile");
  assert.deepEqual(server.deploy?.preDeployCommand, ["node dist/database/migrate.js"]);
  assert.equal(server.deploy?.healthcheckPath, "/ready");
  assert.equal(server.deploy?.healthcheckTimeout, 30);
});

test("Railway IaC keeps the wake broker awake on its own Dockerfile", async () => {
  const broker = (await railwaySpec()).resources.find((resource) => resource.address === "service.leilei-wake-broker");
  assert.ok(broker);
  assert.equal(broker.build?.builder, "DOCKERFILE");
  assert.equal(broker.build?.dockerfilePath, "Dockerfile.wake-broker");
  assert.deepEqual(broker.variables?.RAILWAY_DOCKERFILE_PATH, { type: "literal", value: "Dockerfile.wake-broker" });
  assert.equal(broker.deploy?.sleepApplication, false);
  assert.equal(broker.deploy?.restartPolicyType, "ALWAYS");
  assert.equal(broker.deploy?.healthcheckPath, "/health");
});

test("Railway IaC declares every environment resource so apply cannot delete one", async () => {
  const addresses = (await railwaySpec()).resources.map((resource) => resource.address).sort();
  for (const expected of ["service.leilei-os", "service.leilei-wake-broker"]) assert.ok(addresses.includes(expected), expected);
  assert.ok(addresses.some((address) => /postgres/i.test(address) && !/volume/.test(address)), "Postgres");
  assert.ok(addresses.some((address) => address.includes("postgres-volume")), "Postgres volume");
  assert.ok(addresses.some((address) => address.includes("leilei-native-live-attachments")), "attachment bucket");
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
