import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveSemanticHandshakeService,
  createNativeLiveSemanticRecoveryRunner,
} from "../src/domains/bridge/native-live-semantic-handshake.js";

const request = (prepareId: string) => ({
  prepareId,
  userId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  manifestId: "33333333-3333-4333-8333-333333333333",
  assembledAt: "2026-09-27T03:00:00.000Z",
  snapshotSequence: 1,
  query: "hello",
  candidates: [{
    stateId: "44444444-4444-4444-8444-444444444444",
    kind: "memory" as const,
    text: "memory",
  }],
  status: "completed" as const,
  reservedBy: null,
  scores: {
    "44444444-4444-4444-8444-444444444444": 0.9,
  },
  fallbackCode: null,
});

test("semantic completion failure is durably deferred so later completion can proceed", async () => {
  const requests = [
    request("55555555-5555-4555-8555-555555555555"),
    request("66666666-6666-4666-8666-666666666666"),
  ];
  const deferred: unknown[] = [];
  const repository = {
    async findCompletionPending() {
      return requests.shift() ?? null;
    },
    async deferCompletion(input: unknown) {
      deferred.push(input);
      return true;
    },
  };
  const turns = {
    async getPreparation(input: { prepareId: string }) {
      return {
        prepareId: input.prepareId,
        requestId: "77777777-7777-4777-8777-777777777777",
        userId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        operation: "send" as const,
        canonicalUserMessageId: "88888888-8888-4888-8888-888888888888",
        runtimeMode: "new" as const,
        parentProviderSessionId: null,
        prompt: "assembled",
        mindPrepared: true,
      };
    },
    async persistMindPreparedPrompt() {
      throw new Error("must not rebuild an already prepared prompt");
    },
  };
  let enqueueCalls = 0;
  const relay = {
    async enqueuePreparation() {
      enqueueCalls += 1;
      if (enqueueCalls === 1) {
        throw new Error("simulated relay enqueue failure");
      }
    },
  };
  const mind = {
    async preparePrompt() {
      return "unused";
    },
    parseAssistantBlocks(blocks: unknown[]) {
      return { visibleBlocks: blocks, intents: [] };
    },
    async afterFinalize() {},
    async completeSemanticPrompt() {
      return "unused";
    },
  };

  const service = new NativeLiveSemanticHandshakeService(
    repository as never,
    turns,
    mind as never,
    relay,
  );

  assert.equal(await service.processNextCompletion(), "deferred");
  assert.deepEqual(deferred, [{
    userId: "11111111-1111-4111-8111-111111111111",
    prepareId: "55555555-5555-4555-8555-555555555555",
    errorName: "Error",
  }]);

  assert.equal(await service.processNextCompletion(), "processed");
  assert.equal(enqueueCalls, 2);
});

test("semantic recovery runner continues past a durably deferred completion", async () => {
  const outcomes = ["deferred", "processed", "idle"] as const;
  let calls = 0;
  const recovery = createNativeLiveSemanticRecoveryRunner({
    service: {
      async processNextCompletion() {
        return outcomes[calls++] ?? "idle";
      },
    },
    batchLimit: 5,
  });

  assert.equal(await recovery.runNow(), 1);
  assert.equal(calls, 3);
  recovery.stop();
  await recovery.drain();
});
