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
  assert.ok(runtime.appDependencies.webNativeLiveCoordinator);
  assert.ok(runtime.appDependencies.webNativeLiveTurnReader);
  assert.ok(runtime.appDependencies.nativeLiveRelayService);
  assert.ok(runtime.appDependencies.nativeLiveSemanticService);
  assert.ok(runtime.appDependencies.nativeLiveBackgroundModelService);
  assert.ok(runtime.appDependencies.nativeLiveBackgroundModelCoordinator);
  assert.ok(runtime.topicResurfaceCrossDeviceCoordinator);
  assert.ok(runtime.driveSatisfactionService);
});
