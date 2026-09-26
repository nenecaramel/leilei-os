import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_TARGETED_LEASE_PRIMARY_KEY,
  BRIDGE_TARGETED_RESERVATION_INDEX,
  BridgeDispatchPartitionError,
  assertBridgeTerminalCallbackOwnership,
  bridgeListenerLeaseKey,
  canBridgeListenerReserve,
  isLegacyBridgeLane,
  resolveStoredBridgeDispatchTarget,
} from "../src/domains/bridge/bridge-dispatch-partition-contract.js";

const userId = "11111111-1111-4111-8111-111111111111";
const listenerId = "22222222-2222-4222-8222-222222222222";

test("legacy rows without target stay isolated to the ChatGPT host lane", () => {
  assert.equal(resolveStoredBridgeDispatchTarget(undefined), "chatgpt_host");
  assert.equal(resolveStoredBridgeDispatchTarget(null), "chatgpt_host");
  assert.equal(isLegacyBridgeLane(undefined), true);
  assert.equal(
    canBridgeListenerReserve({
      eventDispatchTarget: undefined,
      listenerDispatchTarget: "chatgpt_host",
    }),
    true,
  );
  assert.equal(
    canBridgeListenerReserve({
      eventDispatchTarget: undefined,
      listenerDispatchTarget: "claude_code",
    }),
    false,
  );
});

test("explicit Claude events are invisible to the ChatGPT host listener", () => {
  assert.equal(
    canBridgeListenerReserve({
      eventDispatchTarget: "claude_code",
      listenerDispatchTarget: "claude_code",
    }),
    true,
  );
  assert.equal(
    canBridgeListenerReserve({
      eventDispatchTarget: "claude_code",
      listenerDispatchTarget: "chatgpt_host",
    }),
    false,
  );
});

test("listener lease identity is partitioned by user and dispatch target", () => {
  assert.notEqual(
    bridgeListenerLeaseKey({ userId, dispatchTarget: "chatgpt_host" }),
    bridgeListenerLeaseKey({ userId, dispatchTarget: "claude_code" }),
  );
  assert.deepEqual(BRIDGE_TARGETED_LEASE_PRIMARY_KEY, [
    "user_id",
    "dispatch_target",
  ]);
});

test("reservation index contract includes dispatch target before status ordering", () => {
  assert.deepEqual(BRIDGE_TARGETED_RESERVATION_INDEX, [
    "user_id",
    "dispatch_target",
    "status",
    "created_at",
    "id",
  ]);
});

test("terminal callbacks require both target ownership and reserved listener ownership", () => {
  assert.doesNotThrow(() =>
    assertBridgeTerminalCallbackOwnership({
      eventDispatchTarget: "claude_code",
      reservedBy: listenerId,
      scope: {
        userId,
        dispatchTarget: "claude_code",
        listenerInstanceId: listenerId,
      },
    }),
  );

  assert.throws(
    () =>
      assertBridgeTerminalCallbackOwnership({
        eventDispatchTarget: "chatgpt_host",
        reservedBy: listenerId,
        scope: {
          userId,
          dispatchTarget: "claude_code",
          listenerInstanceId: listenerId,
        },
      }),
    (error: unknown) =>
      error instanceof BridgeDispatchPartitionError
      && error.code === "BRIDGE_TARGET_MISMATCH",
  );

  assert.throws(
    () =>
      assertBridgeTerminalCallbackOwnership({
        eventDispatchTarget: "claude_code",
        reservedBy: "33333333-3333-4333-8333-333333333333",
        scope: {
          userId,
          dispatchTarget: "claude_code",
          listenerInstanceId: listenerId,
        },
      }),
    (error: unknown) =>
      error instanceof BridgeDispatchPartitionError
      && error.code === "BRIDGE_LISTENER_OWNER_MISMATCH",
  );
});
