import assert from "node:assert/strict";
import test from "node:test";
import { createProcessRuntime } from "../src/app/process-runtime.js";

test("process runtime exposes bridge service from the shared database resource", () => {
  let resources = 0;
  const fake = { db: {} as never, probe: async () => undefined, close: async () => undefined };
  const runtime = createProcessRuntime({
    environment: {
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
      LEILEI_TOY_BRIDGE_USER_ID: "00000000-0000-4000-8000-000000000001",
    } as never,
    createDatabaseResource: () => {
      resources += 1;
      return fake;
    },
  });
  assert.equal(resources, 1);
  assert.ok(runtime.appDependencies);
  assert.ok(runtime.appDependencies.nativeLiveProduction);
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.web.coordinator,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.web.turnReader,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.web.turnWaitService,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.web.currentPathReader,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.internal.relayService,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.internal.semanticService,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.internal.backgroundModelService,
  );
  assert.ok(
    runtime.appDependencies.nativeLiveProduction.internal.backgroundModelCoordinator,
  );
});


test("process runtime exposes Topic resurface opportunity only when explicitly enabled", () => {
  const fake = { db: {} as never, probe: async () => undefined, close: async () => undefined };
  const disabled = createProcessRuntime({
    environment: {
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
    } as never,
    createDatabaseResource: () => fake,
  });
  assert.equal(
    disabled.appDependencies.nativeLiveProduction
      ?.internal.backgroundModelOpportunity,
    undefined,
  );

  const enabled = createProcessRuntime({
    environment: {
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
      NATIVE_LIVE_TOPIC_RESURFACE_ENABLED: true,
      NATIVE_LIVE_TOPIC_RESURFACE_CANDIDATE_LIMIT: 5,
    } as never,
    createDatabaseResource: () => fake,
  });
  assert.ok(
    enabled.appDependencies.nativeLiveProduction
      ?.internal.backgroundModelOpportunity,
  );
});


test("production wiring skips per-turn Effect scans while Proactivity is disabled", async () => {
  const fake = {
    db: {} as never,
    probe: async () => undefined,
    close: async () => undefined,
  };
  const runtime = createProcessRuntime({
    environment: {
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
    } as never,
    createDatabaseResource: () => fake,
  });

  const result =
    await runtime.appDependencies.nativeLiveProduction
      .internal.companionBackgroundOpportunity.offer({
        userId: "00000000-0000-4000-8000-000000000001",
        reason: "dirty",
      });

  assert.equal(result.effectDeliveryScheduled, false);
  assert.deepEqual(result.failures, []);
});
