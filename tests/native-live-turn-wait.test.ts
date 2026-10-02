import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveBackendTurnReadModel,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  NativeLiveTurnWaitService,
} from "../src/domains/bridge/relay/native-live-turn-wait.js";

function turn(
  overrides: Partial<NativeLiveBackendTurnReadModel> = {},
): NativeLiveBackendTurnReadModel {
  return {
    prepareId: "33333333-3333-4333-8333-333333333333",
    requestId: "44444444-4444-4444-8444-444444444444",
    conversationId: "55555555-5555-4555-8555-555555555555",
    operation: "send",
    canonicalUserMessageId:
      "66666666-6666-4666-8666-666666666666",
    executionSelection: null,
    canonicalStatus: "prepared",
    dispatchStatus: "executing",
    assistantMessage: null,
    runtimeMetadata: null,
    failureCode: null,
    semanticStatus: null,
    semanticFallbackCode: null,
    ...overrides,
  };
}

test("turn wait returns an already-terminal turn without opening a broker wait", async () => {
  let waits = 0;
  const terminal = turn({
    canonicalStatus: "finalized_success",
    dispatchStatus: "completed",
  });
  const service = new NativeLiveTurnWaitService(
    {
      async readTurn() {
        return terminal;
      },
    } as never,
    {
      async start() {},
      turnVersion() {
        return 0;
      },
      async waitForTurnChange() {
        waits += 1;
        return { outcome: "ready" as const, version: 1 };
      },
    },
  );

  assert.deepEqual(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: terminal.prepareId,
      timeoutMs: 25_000,
    }),
    { outcome: "terminal", turn: terminal },
  );
  assert.equal(waits, 0);
});

test("turn wait closes the missed-notify race with a second authoritative read", async () => {
  const pending = turn();
  const terminal = turn({
    canonicalStatus: "finalized_success",
    dispatchStatus: "completed",
  });
  let reads = 0;
  let waits = 0;
  let releases = 0;

  const service = new NativeLiveTurnWaitService(
    {
      async readTurn() {
        reads += 1;
        return reads === 1 ? pending : terminal;
      },
    } as never,
    {
      async start() {},
      turnVersion() {
        return 3;
      },
      async waitForTurnChange() {
        waits += 1;
        return { outcome: "ready" as const, version: 4 };
      },
      async release() {
        releases += 1;
      },
    },
  );

  assert.deepEqual(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: pending.prepareId,
      timeoutMs: 25_000,
    }),
    { outcome: "terminal", turn: terminal },
  );
  assert.equal(reads, 2);
  assert.equal(waits, 0);
  assert.equal(releases, 1);
});

test("turn wait reads terminal state after a wake and returns timeout without polling", async () => {
  const pending = turn();
  const terminal = turn({
    canonicalStatus: "finalized_failure",
    dispatchStatus: "completed",
    failureCode: "CLAUDE_PROCESS_FAILED",
  });
  let reads = 0;
  let mode: "ready" | "timeout" = "ready";

  const service = new NativeLiveTurnWaitService(
    {
      async readTurn() {
        reads += 1;
        if (reads <= 2) return pending;
        return terminal;
      },
    } as never,
    {
      async start() {},
      turnVersion() {
        return 9;
      },
      async waitForTurnChange() {
        return mode === "ready"
          ? { outcome: "ready" as const, version: 10 }
          : { outcome: "timeout" as const, version: 9 };
      },
    },
  );

  assert.deepEqual(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: pending.prepareId,
      timeoutMs: 25_000,
    }),
    { outcome: "terminal", turn: terminal },
  );

  reads = 0;
  mode = "timeout";
  assert.deepEqual(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: pending.prepareId,
      timeoutMs: 25_000,
    }),
    { outcome: "timeout" },
  );
  assert.equal(reads, 2);
});

test("turn wait returns null for an unknown prepare id", async () => {
  const service = new NativeLiveTurnWaitService(
    {
      async readTurn() {
        return null;
      },
    } as never,
    {
      async start() {},
      turnVersion() {
        return 0;
      },
      async waitForTurnChange() {
        throw new Error("must not wait");
      },
    },
  );

  assert.equal(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: "33333333-3333-4333-8333-333333333333",
      timeoutMs: 25_000,
    }),
    null,
  );
});


test("turn wait self-recovers a stale delivery-unknown turn as terminal", async () => {
  let current = turn({
    canonicalStatus: "prepared",
    dispatchStatus: "delivery_unknown",
  });
  let recoveries = 0;
  let waits = 0;

  const service = new NativeLiveTurnWaitService(
    {
      async recoverStaleDeliveryUnknownTurn() {
        recoveries += 1;
        current = turn({
          canonicalStatus: "prepared",
          dispatchStatus: "rejected",
        });
        return true;
      },
      async readTurn() {
        return current;
      },
    } as never,
    {
      async start() {},
      turnVersion() {
        return 0;
      },
      async waitForTurnChange() {
        waits += 1;
        return { outcome: "ready" as const, version: 1 };
      },
    },
  );

  assert.deepEqual(
    await service.wait({
      userId: "11111111-1111-4111-8111-111111111111",
      prepareId: current.prepareId,
      timeoutMs: 25_000,
    }),
    { outcome: "terminal", turn: current },
  );
  assert.equal(recoveries, 1);
  assert.equal(waits, 0);
});
