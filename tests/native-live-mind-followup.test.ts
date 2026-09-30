import assert from "node:assert/strict";
import test from "node:test";
import type { NativeLiveBackendMindRuntime } from "../src/domains/bridge/native-live-backend-mind-runtime.js";
import type { NativeLiveContentBlockInput } from "../src/domains/conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePreparedTurn,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import {
  NativeLiveMindFollowUpService,
  createNativeLiveMindFollowUpRecoveryRunner,
  nativeLiveMindFollowUpStateId,
  type NativeLiveMindFollowUpJob,
  type NativeLiveMindFollowUpPort,
} from "../src/domains/bridge/native-live-mind-followup.js";

const userId = "11111111-1111-4111-8111-111111111111";
const prepareId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const assistantMessageId = "44444444-4444-4444-8444-444444444444";

function preparation(): NativeLivePreparedTurn {
  return {
    prepareId,
    requestId: "55555555-5555-4555-8555-555555555555",
    userId,
    conversationId,
    operation: "send",
    canonicalUserMessageId:
      "66666666-6666-4666-8666-666666666666",
    runtimeMode: "new",
    parentProviderSessionId: null,
    prompt: "assembled",
    mindPrepared: true,
  };
}

function job(): NativeLiveMindFollowUpJob {
  return {
    prepareId,
    userId,
    conversationId,
    assistantMessageId,
    operation: "send",
    actions: [],
    intents: [
      {
        kind: "memory",
        text: "remember this",
        sourceStart: 0,
        sourceEnd: 35,
        raw: "<memory>remember this</memory>",
      },
      {
        kind: "feel",
        text: "warm",
        sourceStart: 36,
        sourceEnd: 53,
        raw: "<feel>warm</feel>",
      },
      {
        kind: "thought",
        text: "keep exploring",
        sourceStart: 54,
        sourceEnd: 90,
        raw: "<thought>keep exploring</thought>",
      },
    ],
  };
}

class FakePort implements NativeLiveMindFollowUpPort {
  next: NativeLiveMindFollowUpJob | null = job();
  completeCalls: unknown[] = [];
  releaseCalls: unknown[] = [];

  async claimByPreparation() {
    const next = this.next;
    this.next = null;
    return next;
  }

  async claimNext() {
    const next = this.next;
    this.next = null;
    return next;
  }

  async complete(input: unknown) {
    this.completeCalls.push(input);
    return true;
  }

  async releaseFailure(input: unknown) {
    this.releaseCalls.push(input);
    return true;
  }
}

class FakeMind implements NativeLiveBackendMindRuntime {
  finalizeCalls: unknown[] = [];
  shouldFail = false;

  async preparePrompt() {
    return "assembled";
  }

  parseAssistantBlocks(blocks: readonly NativeLiveContentBlockInput[]) {
    return { visibleBlocks: blocks, intents: [] };
  }

  async afterFinalize(input: unknown) {
    this.finalizeCalls.push(input);
    if (this.shouldFail) throw new Error("simulated Mind failure");
  }
}

function setup(
  semanticActions: {
    execute(input: unknown): Promise<any>;
  } | null = null,
) {
  const port = new FakePort();
  const mind = new FakeMind();
  const turns: Pick<NativeLiveBackendTurnPort, "getPreparation"> = {
    async getPreparation() {
      return preparation();
    },
  };
  const service = new NativeLiveMindFollowUpService(
    port,
    turns,
    mind,
    "77777777-7777-4777-8777-777777777777",
    semanticActions,
  );
  return { port, mind, service };
}

test("durable Mind follow-up uses stable per-intent UUIDs and completes only after Mind succeeds", async () => {
  const { port, mind, service } = setup();

  assert.equal(
    await service.processPreparation({ userId, prepareId }),
    "processed",
  );
  assert.equal(mind.finalizeCalls.length, 1);

  const call = mind.finalizeCalls[0] as {
    stateIds: string[];
  };
  assert.deepEqual(call.stateIds, [
    nativeLiveMindFollowUpStateId(prepareId, 0),
    nativeLiveMindFollowUpStateId(prepareId, 1),
    nativeLiveMindFollowUpStateId(prepareId, 2),
  ]);
  assert.notEqual(call.stateIds[0], call.stateIds[1]);
  assert.match(
    call.stateIds[0]!,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(port.completeCalls.length, 1);
  assert.equal(port.releaseCalls.length, 0);
});

test("durable Mind follow-up executes staged thought drops only after canonical finalize and persists receipts", async () => {
  const receipts = [
    {
      actionIndex: 0,
      kind: "thought_drop",
      ref: "T1",
      stateId: "88888888-8888-4888-8888-888888888888",
      outcome: "applied",
    },
    {
      actionIndex: 1,
      kind: "thought_drop",
      ref: "T2",
      stateId: "99999999-9999-4999-8999-999999999999",
      outcome: "idempotent",
    },
  ];
  const semanticCalls: unknown[] = [];
  const { port, mind, service } = setup({
    async execute(input) {
      semanticCalls.push(input);
      // The drop must not run before the canonical finalize has happened.
      assert.equal(mind.finalizeCalls.length, 1);
      return receipts[semanticCalls.length - 1]!;
    },
  });
  port.next = {
    ...job(),
    intents: [],
    actions: [
      {
        kind: "thought_drop",
        ref: "T1",
        sourceStart: 0,
        sourceEnd: 1,
        raw: "x",
      },
      {
        kind: "thought_drop",
        ref: "T2",
        sourceStart: 2,
        sourceEnd: 3,
        raw: "y",
      },
    ],
  };

  assert.equal(
    await service.processPreparation({ userId, prepareId }),
    "processed",
  );
  assert.equal(semanticCalls.length, 2);
  assert.deepEqual(
    (port.completeCalls[0] as { receipts: unknown[] }).receipts,
    receipts,
  );
  assert.equal(port.releaseCalls.length, 0);
});

test("failed Mind follow-up is released for durable retry instead of fabricating completion", async () => {
  const { port, mind, service } = setup();
  mind.shouldFail = true;

  await assert.rejects(
    () => service.processPreparation({ userId, prepareId }),
    /simulated Mind failure/u,
  );
  assert.equal(port.completeCalls.length, 0);
  assert.equal(port.releaseCalls.length, 1);
});

test("Mind follow-up scheduler drains bounded work and never lets one failed job stop later work", async () => {
  let calls = 0;
  const service = {
    async processNext() {
      calls += 1;
      if (calls === 1) throw new Error("retry later");
      if (calls === 2) return "processed" as const;
      return "idle" as const;
    },
  };

  const recovery = createNativeLiveMindFollowUpRecoveryRunner({
    service,
    batchLimit: 4,
  });

  assert.equal(await recovery.runNow(), 1);
  assert.equal(calls, 3);
  recovery.stop();
  await recovery.drain();
});
