import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createAppSource = readFileSync("src/app/create-app.ts", "utf8");

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

test("createApp receives resources instead of constructing a database", () => {
  assert.doesNotMatch(createAppSource, /createDatabase\s*\(/);
  assert.doesNotMatch(createAppSource, /createDatabaseReadinessProbe/);
  assert.match(createAppSource, /dependencies\.databaseReadinessProbe/);
});
