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
  parseNativeLiveMindFollowUpIntents,
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
        kind: "drive",
        text: "keep exploring",
        sourceStart: 54,
        sourceEnd: 90,
        raw: "<drive>keep exploring</drive>",
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
  backgroundOpportunity: {
    schedule(input: {
      userId: string;
      conversationId: string;
    }): void;
  } | null = null,
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
    backgroundOpportunity,
    semanticActions,
  );
  return { port, mind, service };
}



test("durable Mind replay rejects retired authored Dream and Topic intents", () => {
  for (const kind of ["dream", "topic"]) {
    assert.throws(
      () => parseNativeLiveMindFollowUpIntents([{
        kind,
        text: "legacy",
        sourceStart: 0,
        sourceEnd: 8,
        raw: `<${kind}>legacy</${kind}>`,
      }]),
      /Mind follow-up intent is invalid/u,
    );
  }

  assert.deepEqual(
    parseNativeLiveMindFollowUpIntents([{
      kind: "memory",
      text: "current",
      sourceStart: 0,
      sourceEnd: 8,
      raw: "<memory>current</memory>",
    }]),
    [{
      kind: "memory",
      text: "current",
      sourceStart: 0,
      sourceEnd: 8,
      raw: "<memory>current</memory>",
    }],
  );
});

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

test("durable Mind follow-up executes staged semantic actions only after canonical finalize and persists receipts", async () => {
  const receipts = [
    {
      actionIndex: 0,
      kind: "mind_satisfy",
      stateId: "88888888-8888-4888-8888-888888888888",
      outcome: "applied",
    },
    {
      actionIndex: 1,
      kind: "mind_resolve",
      stateId: "99999999-9999-4999-8999-999999999999",
      outcome: "idempotent",
    },
  ];
  const semanticCalls: unknown[] = [];
  const { port, service } = setup(null, {
    async execute(input) {
      semanticCalls.push(input);
      return receipts[semanticCalls.length - 1]!;
    },
  });
  port.next = {
    ...job(),
    intents: [],
    actions: [
      {
        kind: "mind_satisfy",
        stateId: "88888888-8888-4888-8888-888888888888",
        level: "partial",
        sourceStart: 0,
        sourceEnd: 1,
        raw: "x",
      },
      {
        kind: "mind_resolve",
        stateId: "99999999-9999-4999-8999-999999999999",
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

test("completed durable Mind follow-up offers one fail-soft post-turn background opportunity", async () => {
  const scheduled: unknown[] = [];
  const { port, service } = setup({
    schedule(input) {
      scheduled.push(input);
      throw new Error("background scheduling stays soft");
    },
  });

  assert.equal(
    await service.processPreparation({ userId, prepareId }),
    "processed",
  );
  assert.deepEqual(scheduled, [{
    userId,
    conversationId,
  }]);
  assert.equal(port.completeCalls.length, 1);
  assert.equal(port.releaseCalls.length, 0);
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
