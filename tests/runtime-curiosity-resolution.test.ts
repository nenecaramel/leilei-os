import assert from "node:assert/strict";
import test from "node:test";
import {
  CuriosityResolutionService,
  type CuriosityResolutionResult,
} from "../src/domains/runtime/curiosity-resolution.js";

test("Curiosity resolution first settles current lifecycle state, then applies explicit resolution", async () => {
  const calls: string[] = [];
  const expected: CuriosityResolutionResult = {
    outcome: "applied",
    curiosityStateId: "curiosity-1",
    resolvedAt: "2026-09-27T12:00:00.000Z",
    resolutionSourceId: "answer-message-1",
    updatedStates: 2,
  };
  const service = new CuriosityResolutionService(
    {
      async runOnce(input) {
        calls.push(
          "evolve:"
          + input.userId
          + ":"
          + input.subjectId
          + ":"
          + String(input.mode),
        );
        return {
          scanned: 0,
          threads: 0,
          applied: 0,
          conflicts: 0,
          initialized: 0,
          reinforced: 0,
          dormantTransitions: 0,
          reactivated: 0,
          active: 0,
          resolved: 0,
          dormant: 0,
        };
      },
    },
    {
      async resolve(input) {
        calls.push("resolve:" + input.curiosityStateId);
        return expected;
      },
    },
  );

  const result = await service.resolve({
    userId: "u1",
    subjectId: "G",
    curiosityStateId: "curiosity-1",
    conversationId: "conversation-1",
    resolutionSourceId: "answer-message-1",
    idempotencyKey: "curiosity-resolution-test-1",
    now: "2026-09-27T12:00:00.000Z",
  });

  assert.deepEqual(result, expected);
  assert.deepEqual(calls, [
    "evolve:u1:G:settlement_catch_up",
    "resolve:curiosity-1",
  ]);
});
