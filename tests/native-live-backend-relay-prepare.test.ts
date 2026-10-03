import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveBackendMindRuntime,
} from "../src/domains/bridge/mind/native-live-backend-mind-runtime.js";
import {
  NativeLiveBackendRelayPrepareCoordinator,
} from "../src/domains/bridge/relay/native-live-backend-relay-prepare.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveSemanticPreparationStager,
} from "../src/domains/bridge/mind/native-live-semantic-handshake.js";
import type {
  NativeLiveContentBlockInput,
} from "../src/domains/conversation/native-live-conversation-types.js";

const userId = "11111111-1111-4111-8111-111111111111";
const prepareId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const userMessageId = "55555555-5555-4555-8555-555555555555";

function prepared(
  input: Partial<NativeLivePreparedTurn> = {},
): NativeLivePreparedTurn {
  return {
    prepareId,
    requestId,
    userId,
    conversationId,
    operation: "send",
    canonicalUserMessageId: userMessageId,
    runtimeMode: "new",
    parentProviderSessionId: null,
    prompt: "solo travel independent",
    mindPrepared: false,
    ...input,
  };
}

class FakePort implements NativeLiveBackendTurnPort {
  prepareResult: NativeLivePreparePortResult = {
    ok: true,
    outcome: "created",
    preparation: prepared(),
  };
  persistCalls: unknown[] = [];
  prepareSendCalls: Parameters<
    NativeLiveBackendTurnPort["prepareSend"]
  >[0][] = [];

  async prepareSend(
    input: Parameters<NativeLiveBackendTurnPort["prepareSend"]>[0],
  ) {
    this.prepareSendCalls.push(input);
    return this.prepareResult;
  }
  async prepareRetry() {
    return this.prepareResult;
  }
  async prepareEdit() {
    return this.prepareResult;
  }
  async getPreparation() {
    return this.prepareResult.ok
      ? this.prepareResult.preparation
      : null;
  }
  async persistMindPreparedPrompt(input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }) {
    this.persistCalls.push(input);
    return prepared({
      prompt: input.prompt,
      mindPrepared: true,
    });
  }
  async finalizeSuccess(
    _input: Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0],
  ) {
    return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
  }
  async finalizeFailure() {
    return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
  }
}

class FakeMind implements NativeLiveBackendMindRuntime {
  planCalls: unknown[] = [];
  prepareCalls: unknown[] = [];
  semanticPlan: Awaited<
    ReturnType<NonNullable<NativeLiveBackendMindRuntime["planSemanticPrompt"]>>
  > = {
    manifestId: "66666666-6666-4666-8666-666666666666",
    assembledAt: "2026-09-22T14:00:00.000Z",
    snapshotSequence: 1,
    query: "solo travel independent",
    candidates: [{
      stateId: "state-travel",
      kind: "memory",
      text: "独自旅行让我觉得自己可以照顾好自己",
    }],
  };

  async preparePrompt(input: unknown) {
    this.prepareCalls.push(input);
    return "ASSEMBLED";
  }
  async planSemanticPrompt(input: unknown) {
    this.planCalls.push(input);
    return this.semanticPlan;
  }
  async completeSemanticPrompt() {
    return "SEMANTIC_ASSEMBLED";
  }
  parseAssistantBlocks(blocks: readonly NativeLiveContentBlockInput[]) {
    return { visibleBlocks: [...blocks], intents: [] };
  }
  async afterFinalize() {}
}

class FakeSemanticStager implements NativeLiveSemanticPreparationStager {
  calls: unknown[] = [];
  stagedPlan: Awaited<
    ReturnType<NonNullable<NativeLiveSemanticPreparationStager["readPlan"]>>
  > = null;

  async stage(input: unknown) {
    this.calls.push(input);
  }

  async readPlan() {
    return this.stagedPlan;
  }
}

function request() {
  return {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: null,
    text: "solo travel independent",
  };
}

test("relay prepare forwards voice identity into canonical send preparation", async () => {
  const port = new FakePort();
  const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
    port,
    null,
    null,
    () => prepareId,
  );

  const result = await coordinator.prepare(userId, {
    ...request(),
    input_mode: "voice",
  });

  assert.equal(result.ok, true);
  assert.equal(port.prepareSendCalls.length, 1);
  assert.equal(port.prepareSendCalls[0]?.inputMode, "voice");
});

test("relay prepare stages semantic scoring without persisting a lexical prompt first", async () => {
  const port = new FakePort();
  const mind = new FakeMind();
  const semantic = new FakeSemanticStager();
  const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
    port,
    mind,
    semantic,
    () => prepareId,
  );

  const result = await coordinator.prepare(userId, request());

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected relay prepare success");
  assert.equal(result.semanticPending, true);
  assert.equal(result.command.prompt, "solo travel independent");
  assert.equal(mind.planCalls.length, 1);
  assert.equal(mind.prepareCalls.length, 0);
  assert.equal(port.persistCalls.length, 0);
  assert.equal(semantic.calls.length, 1);
});

test("relay prepare falls back to immediate lexical assembly when no semantic candidates exist", async () => {
  const port = new FakePort();
  const mind = new FakeMind();
  mind.semanticPlan = null;
  const semantic = new FakeSemanticStager();
  const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
    port,
    mind,
    semantic,
    () => prepareId,
  );

  const result = await coordinator.prepare(userId, request());

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected relay prepare success");
  assert.equal(result.semanticPending, false);
  assert.equal(result.command.prompt, "ASSEMBLED");
  assert.equal(mind.prepareCalls.length, 1);
  assert.equal(port.persistCalls.length, 1);
  assert.equal(semantic.calls.length, 0);
});

test("relay prepare replay reuses an existing semantic snapshot instead of rebuilding it", async () => {
  const port = new FakePort();
  port.prepareResult = {
    ok: true,
    outcome: "replayed",
    preparation: prepared(),
  };
  const mind = new FakeMind();
  const semantic = new FakeSemanticStager();
  semantic.stagedPlan = mind.semanticPlan;
  const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
    port,
    mind,
    semantic,
    () => prepareId,
  );

  const result = await coordinator.prepare(userId, request());

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected semantic replay success");
  assert.equal(result.semanticPending, true);
  assert.equal(mind.planCalls.length, 0);
  assert.equal(mind.prepareCalls.length, 0);
  assert.equal(semantic.calls.length, 0);
  assert.equal(port.persistCalls.length, 0);
});

test("relay prepare replay reuses an already prepared prompt and never restages semantics", async () => {
  const port = new FakePort();
  port.prepareResult = {
    ok: true,
    outcome: "replayed",
    preparation: prepared({
      prompt: "PERSISTED",
      mindPrepared: true,
    }),
  };
  const mind = new FakeMind();
  const semantic = new FakeSemanticStager();
  const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
    port,
    mind,
    semantic,
    () => prepareId,
  );

  const result = await coordinator.prepare(userId, request());

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected relay replay success");
  assert.equal(result.semanticPending, false);
  assert.equal(result.command.prompt, "PERSISTED");
  assert.equal(mind.planCalls.length, 0);
  assert.equal(semantic.calls.length, 0);
});
