import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRuntimeInteractionService,
  type NativeLiveRuntimeInteractionRecord,
} from "../src/domains/bridge/native-live-runtime-interaction.js";

function pendingInteraction(): NativeLiveRuntimeInteractionRecord {
  return {
    interactionId: "7c04ae79-e6eb-4f92-9174-889f8bc65701",
    prepareId: "7cacaa4a-a900-4b74-b115-424f71701390",
    kind: "permission",
    request: { toolName: "mcp__leileios__read_todo_day" },
    status: "pending",
    response: null,
    createdAt: "2026-09-30T01:40:00.000Z",
    updatedAt: "2026-09-30T01:40:00.000Z",
    resolvedAt: null,
    cancelledAt: null,
  };
}

test("pending interaction is cancelled when its parent turn is no longer active", async () => {
  let row = pendingInteraction();
  let cancelCalls = 0;
  const repository = {
    async readForListener() {
      return row;
    },
    async isTurnActiveForListener() {
      return false;
    },
    async cancelForListener() {
      cancelCalls += 1;
      row = {
        ...row,
        status: "cancelled",
        cancelledAt: "2026-09-30T01:51:00.000Z",
        updatedAt: "2026-09-30T01:51:00.000Z",
      };
      return "cancelled" as const;
    },
  };

  const service = new NativeLiveRuntimeInteractionService(
    repository as never,
  );
  const result = await service.waitForListener({
    userId: "11111111-1111-4111-8111-111111111111",
    listenerInstanceId: "listener-a",
    reservationId: row.prepareId,
    interactionId: row.interactionId,
    timeoutMs: 25_000,
  });

  assert.equal(result.outcome, "terminal");
  if (result.outcome === "terminal") {
    assert.equal(result.interaction.status, "cancelled");
  }
  assert.equal(cancelCalls, 1);
});

test("pending interaction remains pending while parent turn is active", async () => {
  const row = pendingInteraction();
  const repository = {
    async readForListener() {
      return row;
    },
    async isTurnActiveForListener() {
      return true;
    },
    async cancelForListener() {
      throw new Error("must not cancel");
    },
  };

  const service = new NativeLiveRuntimeInteractionService(
    repository as never,
  );
  const result = await service.waitForListener({
    userId: "11111111-1111-4111-8111-111111111111",
    listenerInstanceId: "listener-a",
    reservationId: row.prepareId,
    interactionId: row.interactionId,
    timeoutMs: 25_000,
  });

  assert.deepEqual(result, { outcome: "timeout" });
});
