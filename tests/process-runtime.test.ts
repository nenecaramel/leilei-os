import { env } from "../src/config/env.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createAppSource = readFileSync("src/app/create-app.ts", "utf8");
const indexSource = readFileSync("src/app/index.ts", "utf8");
const processRuntimeSource = readFileSync("src/app/process-runtime.ts", "utf8");

test("process runtime owns one injectable database resource", async () => {
  const { createProcessRuntime } = await import("../src/app/process-runtime.js");
  let factoryCalls = 0;
  let closeCalls = 0;
  const resource = {
    db: {} as never,
    probe: async () => [],
    close: async () => {
      closeCalls += 1;
    },
  };

  const runtime = createProcessRuntime({
    environment: {
      ...env,
      DATABASE_URL: "postgres://runtime.test/leilei",
      MCP_SESSION_IDLE_TTL_SECONDS: 7_200,
      MCP_SESSION_ABSOLUTE_TTL_SECONDS: 86_400,
      MCP_SESSION_MAX_PER_USER: 8,
      MCP_SESSION_MAX_TOTAL: 32,
      MCP_IDEMPOTENCY_RETENTION_DAYS: 30,
      MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: 24,
    } as never,
    createDatabaseResource: () => {
      factoryCalls += 1;
      return resource;
    },
  });

  assert.equal(factoryCalls, 1);
  assert.equal(runtime.appDependencies.databaseReadinessProbe, resource.probe);
  assert.equal(runtime.appDependencies.mcpSessionRegistry, runtime.mcpSessionRegistry);
  await runtime.closeDatabase();
  assert.equal(closeCalls, 1);
});

test("process runtime owns retention scheduling and drains it before the database is closed", async () => {
  const { createProcessRuntime } = await import("../src/app/process-runtime.js");
  const events: string[] = [];
  let databaseFactoryCalls = 0;
  let releaseRetention!: () => void;
  const retentionBlocked = new Promise<void>((resolve) => {
    releaseRetention = resolve;
  });
  let transactionCalls = 0;
  const resource = {
    db: {
      transaction: async (operation: (transaction: {
        execute: () => Promise<{ id: string }[]>;
        delete: () => { where: () => { returning: () => Promise<{ id: string }[]> } };
      }) => Promise<number>) => operation({
        execute: async () => {
          transactionCalls += 1;
          events.push(`retention_batch:${transactionCalls}`);
          if (transactionCalls === 1) await retentionBlocked;
          return [];
        },
        delete: () => ({ where: () => ({ returning: async () => [] }) }),
      }),
    } as never,
    probe: async () => [],
    close: async () => {
      events.push("database_closed");
    },
  };

  const runtime = createProcessRuntime({
    environment: {
      ...env,
      DATABASE_URL: "postgres://runtime.test/leilei",
      MCP_SESSION_IDLE_TTL_SECONDS: 7_200,
      MCP_SESSION_ABSOLUTE_TTL_SECONDS: 86_400,
      MCP_SESSION_MAX_PER_USER: 8,
      MCP_SESSION_MAX_TOTAL: 32,
      MCP_IDEMPOTENCY_RETENTION_DAYS: 30,
      MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: 24,
    } as never,
    createDatabaseResource: () => {
      databaseFactoryCalls += 1;
      return resource;
    },
  });

  runtime.startBackgroundWork();
  runtime.startBackgroundWork();
  await Promise.resolve();
  assert.equal(databaseFactoryCalls, 1);
  assert.equal(transactionCalls, 1);

  runtime.stopBackgroundWork();
  runtime.stopBackgroundWork();
  const draining = runtime.drainBackgroundWork();
  let drained = false;
  void draining.then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);

  releaseRetention();
  await draining;
  await runtime.closeDatabase();
  // Current scheduling includes attachment retention and all operational tables.
  assert.equal(transactionCalls, 10);
  assert.deepEqual(events, [
    ...Array.from({ length: 10 }, (_, index) => `retention_batch:${index + 1}`),
    "database_closed",
  ]);
});

test("process runtime creates one shared safe logger for app and observers", async () => {
  const { createProcessRuntime } = await import("../src/app/process-runtime.js");
  let loggerCalls = 0;
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const resource = {
    db: {} as never,
    probe: async () => [],
    close: async () => undefined,
  };
  const runtime = createProcessRuntime({
    environment: {
      ...env,
      DATABASE_URL: "postgres://runtime.test/leilei",
      LOG_LEVEL: "warn",
      MCP_SESSION_IDLE_TTL_SECONDS: 7_200,
      MCP_SESSION_ABSOLUTE_TTL_SECONDS: 86_400,
      MCP_SESSION_MAX_PER_USER: 8,
      MCP_SESSION_MAX_TOTAL: 32,
      MCP_IDEMPOTENCY_RETENTION_DAYS: 30,
      MCP_IDEMPOTENCY_CLEANUP_INTERVAL_HOURS: 24,
    } as never,
    createDatabaseResource: () => resource,
    createLogger: (level) => {
      loggerCalls += 1;
      assert.equal(level, "warn");
      return logger;
    },
  });

  assert.equal(loggerCalls, 1);
  assert.equal(runtime.logger, logger);
  assert.equal(runtime.appDependencies.logger, logger);
});

test("createApp receives resources instead of constructing a database", () => {
  assert.doesNotMatch(createAppSource, /createDatabase\s*\(/);
  assert.doesNotMatch(createAppSource, /createDatabaseReadinessProbe/);
  assert.match(createAppSource, /dependencies\.databaseReadinessProbe/);
});

test("process boundary owns runtime and graceful shutdown", () => {
  assert.match(indexSource, /createProcessRuntime\(\)/);
  assert.match(indexSource, /createApp\(runtime\.appDependencies\)/);
  assert.match(indexSource, /createGracefulShutdownController/);
  assert.doesNotMatch(indexSource, /httpServer\.close\([\s\S]*process\.exit/);
});

test("successful listen emits service_started before starting retention work", () => {
  const serviceStarted = indexSource.indexOf('runtime.logger.info("service_started")');
  const startBackgroundWork = indexSource.indexOf("runtime.startBackgroundWork()");

  assert.notEqual(serviceStarted, -1);
  assert.notEqual(startBackgroundWork, -1);
  assert.ok(serviceStarted < startBackgroundWork);
});


test("legacy Proactivity v1 is hard-disabled at process wiring", () => {
  assert.match(
    processRuntimeSource,
    /const legacyProactivityV1Enabled = false;/,
  );
  assert.match(
    processRuntimeSource,
    /legacyProactivityV1Enabled\s*\? runtimeEffectDeliveryWorker\s*:\s*null/,
  );
  assert.match(
    processRuntimeSource,
    /legacyProactivityV1Enabled\s*\? proactivityWakeOpportunityProducer\s*:\s*null/,
  );
  assert.match(
    processRuntimeSource,
    /legacyProactivityV1Enabled\s*\? \[\s*lazyBackgroundWorkflowAdvancer\([\s\S]*?\]\s*:\s*\[\]/,
  );
  assert.match(
    processRuntimeSource,
    /const nativeLiveBackgroundModelRelayService =[\s\S]*?async reserveNext\([\s\S]*?return null;/,
  );
  assert.match(
    processRuntimeSource,
    /backgroundModelService:\s*nativeLiveBackgroundModelRelayService/,
  );
});


test("process runtime defaults Native Live attachments to Postgres without bucket credentials", () => {
  assert.match(
    processRuntimeSource,
    /new PostgresInlineAttachmentObjectStore\([\s\S]*?signingSecret: runtimeEnv\.DATABASE_URL/,
  );
  assert.match(
    processRuntimeSource,
    /const nativeLiveAttachmentService =\s*new NativeLiveAttachmentService/,
  );
  assert.match(
    processRuntimeSource,
    /nativeLiveAttachmentTransferStore:[\s\S]*?nativeLivePostgresAttachmentObjectStore/,
  );
});
