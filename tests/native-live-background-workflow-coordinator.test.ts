import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveBackgroundWorkflowCoordinator,
} from "../src/domains/bridge/background/native-live-background-workflow-coordinator.js";

test("background workflow coordinator advances durable workflows independently", async () => {
  const calls: string[] = [];
  const coordinator = new NativeLiveBackgroundWorkflowCoordinator([
    {
      async advanceNextForUser(input) {
        calls.push("distillation:" + input.userId);
        throw new Error("simulated distillation finalize failure");
      },
    },
    {
      async advanceNextForUser(input) {
        calls.push("topic:" + input.userId);
      },
    },
  ]);

  await assert.doesNotReject(() =>
    coordinator.advanceNextForUser({ userId: "u1" }),
  );
  assert.deepEqual(calls, [
    "distillation:u1",
    "topic:u1",
  ]);
});
