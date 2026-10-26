import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveBackendTurnCoordinator,
  type NativeLiveBackendTurnPort,
  type NativeLivePreparedTurn,
  type NativeLivePreparePortResult,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";
import type { NativeLiveBackendMindRuntime } from "../src/domains/bridge/mind/native-live-backend-mind-runtime.js";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prepareId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";
const targetUserId = "55555555-5555-4555-8555-555555555555";
const assistantId = "66666666-6666-4666-8666-666666666666";
const checkpointId = "77777777-7777-4777-8777-777777777777";
const headId = "88888888-8888-4888-8888-888888888888";
const now = "2026-09-21T00:00:00.000Z";

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
    runtimeMode: "fork",
    parentProviderSessionId: "provider-parent",
    prompt: "hello",
    mindPrepared: false,
    ...input,
  };
}

function assistantMessage(): NativeLiveMessage {
  return {
    id: assistantId,
    conversationId,
    parentMessageId: userMessageId,
    role: "assistant",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [],
  };
}

function checkpoint(): NativeLiveProviderCheckpoint {
  return {
    id: checkpointId,
    conversationId,
    canonicalMessageId: assistantId,
    provider: "claude_code",
    providerSessionId: "provider-child",
    providerCheckpointId: null,
    createdAt: now,
  };
}

class FakePort implements NativeLiveBackendTurnPort {
  prepareSendCalls: unknown[] = [];
  prepareRetryCalls: unknown[] = [];
  prepareEditCalls: unknown[] = [];
  persistMindPreparedPromptCalls: unknown[] = [];
  finalizeSuccessCalls: unknown[] = [];
  finalizeFailureCalls: unknown[] = [];
  discardWakeCalls: unknown[] = [];
  finalizeOutcome: "completed" | "idempotent" = "completed";
  preparation: NativeLivePreparedTurn | null = prepared();
  prepareResult: NativeLivePreparePortResult = {
    ok: true,
    outcome: "created",
    preparation: prepared(),
  };

  async prepareSend(input: unknown) {
    this.prepareSendCalls.push(input);
    return this.prepareResult;
  }

  async prepareRetry(input: unknown) {
    this.prepareRetryCalls.push(input);
    return this.prepareResult;
  }

  async prepareEdit(input: unknown) {
    this.prepareEditCalls.push(input);
    return this.prepareResult;
  }

  async getPreparation() {
    return this.preparation;
  }

  async persistMindPreparedPrompt(input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }) {
    this.persistMindPreparedPromptCalls.push(input);
    const next = {
      ...(this.prepareResult.ok
        ? this.prepareResult.preparation
        : prepared()),
      prompt: input.prompt,
      mindPrepared: true,
    };
    this.preparation = next;
    if (this.prepareResult.ok) {
      this.prepareResult = {
        ...this.prepareResult,
        preparation: next,
      };
    }
    return next;
  }

  async finalizeSuccess(
    input: Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0],
  ) {
    this.finalizeSuccessCalls.push(input);
    return {
      ok: true as const,
      outcome: this.finalizeOutcome,
      record: {
        assistantMessage: assistantMessage(),
        checkpoint: checkpoint(),
      },
    };
  }

  async finalizeFailure(input: unknown) {
    this.finalizeFailureCalls.push(input);
    return { ok: true as const, outcome: "recorded" as const };
  }

  async discardWake(input: unknown) {
    this.discardWakeCalls.push(input);
    return "discarded" as const;
  }
}

class FakePostFinalize {
  calls: unknown[] = [];
  shouldFail = false;

  async processPreparation(input: unknown) {
    this.calls.push(input);
    if (this.shouldFail) throw new Error("simulated follow-up failure");
    return "processed" as const;
  }
}

class FakeMind implements NativeLiveBackendMindRuntime {
  prepareCalls: unknown[] = [];
  parseCalls: unknown[] = [];
  finalizeCalls: unknown[] = [];
  preparedPrompt = "ASSEMBLED_PROMPT";

  async preparePrompt(input: unknown) {
    this.prepareCalls.push(input);
    return this.preparedPrompt;
  }

  parseAssistantBlocks(blocks: readonly NativeLiveContentBlockInput[]) {
    this.parseCalls.push(blocks);
    return {
      visibleBlocks: blocks.map((block) =>
        block.kind === "text"
          ? { ...block, text: block.text?.replace(/<memory>.*?<\/memory>/gu, "").trim() ?? null }
          : block
      ),
      intents: [{
        kind: "memory" as const,
        text: "remember this",
        sourceStart: 6,
        sourceEnd: 41,
        raw: "<memory>remember this</memory>",
      }],
    };
  }

  async afterFinalize(input: unknown) {
    this.finalizeCalls.push(input);
  }
}

function setup(options: {
  mind?: NativeLiveBackendMindRuntime | null;
  postFinalize?: FakePostFinalize | null;
} = {}) {
  const port = new FakePort();
  const coordinator = new NativeLiveBackendTurnCoordinator(
    port,
    () => prepareId,
    options.mind ?? null,
    options.postFinalize ?? null,
  );
  return { port, coordinator };
}

test("prepare Send forwards stale-head precondition and emits a fork command from persisted preparation", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(port.prepareSendCalls, [{
    prepareId,
    userId,
    requestId,
    conversationId,
    expectedHeadMessageId: headId,
    text: "hello",
    attachmentIds: [],
    executionSelection: null,
  }]);
  if (!result.ok) throw new Error("expected success");
  assert.deepEqual(result.command, {
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "fork",
    parent_provider_session_id: "provider-parent",
    expected_working_directory: null,
    execution_selection: null,
    prompt: "hello",
  });
});

test("prepare replay uses the stored preparation identity rather than the new candidate id", async () => {
  const { port, coordinator } = setup();
  const replayPrepareId = "99999999-9999-4999-8999-999999999999";
  port.prepareResult = {
    ok: true,
    outcome: "replayed",
    preparation: prepared({ prepareId: replayPrepareId }),
  };

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.outcome, "replayed");
  assert.equal(result.command.prepare_id, replayPrepareId);
});

test("prepare Retry and Edit preserve exact historical branch requests", async () => {
  const { port, coordinator } = setup();

  port.prepareResult = {
    ok: true,
    outcome: "created",
    preparation: prepared({
      operation: "retry",
      canonicalUserMessageId: targetUserId,
      prompt: "original prompt",
    }),
  };
  await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "retry",
    conversation_id: conversationId,
    target_user_message_id: targetUserId,
  });
  assert.deepEqual(port.prepareRetryCalls[0], {
    prepareId,
    userId,
    requestId,
    conversationId,
    targetUserMessageId: targetUserId,
    executionSelection: null,
  });

  port.prepareResult = {
    ok: true,
    outcome: "created",
    preparation: prepared({
      operation: "edit",
      prompt: "replacement",
    }),
  };
  await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "edit",
    conversation_id: conversationId,
    target_user_message_id: targetUserId,
    text: "replacement",
  });
  assert.deepEqual(port.prepareEditCalls[0], {
    prepareId,
    userId,
    requestId,
    conversationId,
    targetUserMessageId: targetUserId,
    text: "replacement",
    attachmentIds: null,
    executionSelection: null,
  });
});

test("prepare failure preserves stable stale-head evidence and does not invent a runtime command", async () => {
  const { port, coordinator } = setup();
  port.prepareResult = {
    ok: false,
    code: "STALE_HEAD",
    currentHeadMessageId: "99999999-9999-4999-8999-999999999999",
  };

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.deepEqual(result, {
    ok: false,
    requestId,
    operation: "send",
    conversationId,
    code: "STALE_HEAD",
    currentHeadMessageId: "99999999-9999-4999-8999-999999999999",
  });
});

test("successful finalize validates identity, canonicalizes events, and delegates one atomic success mutation", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      { type: "text", payload: { text: "READY" } },
      { type: "result", payload: { status: "success", final_text: "READY" } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(port.finalizeSuccessCalls.length, 1);
  assert.equal(port.finalizeFailureCalls.length, 0);
  const call = port.finalizeSuccessCalls[0] as {
    providerSessionId: string;
    blocks: NativeLiveContentBlockInput[];
  };
  assert.equal(call.providerSessionId, "provider-child");
  assert.deepEqual(call.blocks, [{
    kind: "text",
    rawType: "text",
    text: "READY",
  }]);
  assert.deepEqual(result, {
    ok: true,
    outcome: "completed",
    requestId,
    operation: "send",
    conversationId,
    userMessageId,
    assistantMessageId: assistantId,
    checkpointId,
    providerSessionId: "provider-child",
  });
});

test("murmur is stripped before Mind parsing and persisted as a separate assistant block", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      {
        type: "text",
        payload: {
          text:
            "Visible answer.\n\n<murmur><memory>never index this</memory> tiny aside</murmur>",
        },
      },
      {
        type: "result",
        payload: {
          status: "success",
          final_text:
            "Visible answer.\n\n<murmur><memory>never index this</memory> tiny aside</murmur>",
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(mind.parseCalls.length, 1);
  assert.deepEqual(mind.parseCalls[0], [{
    kind: "text",
    rawType: "text",
    text: "Visible answer.",
  }]);

  const call = port.finalizeSuccessCalls[0] as {
    blocks: NativeLiveContentBlockInput[];
  };
  assert.deepEqual(call.blocks, [
    {
      kind: "text",
      rawType: "text",
      text: "Visible answer.",
    },
    {
      kind: "murmur",
      rawType: "murmur",
      text: "never index this tiny aside",
      payload: {
        schema_version: 1,
        identity: "murmur",
      },
    },
  ]);
});

test("finalize accepts a v2 result for a preparation dispatched during rolling upgrade", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child-v2",
    normalized_events: [
      { type: "text", payload: { text: "READY" } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(port.finalizeSuccessCalls.length, 1);
});

test("runtime failure finalizes only the failed preparation and never creates an assistant", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
    runtime_metadata: {
      context_usage: null,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(port.finalizeSuccessCalls.length, 0);
  assert.equal(port.finalizeFailureCalls.length, 1);
  assert.deepEqual(
    (
      port.finalizeFailureCalls[0] as {
        runtimeMetadata: unknown;
      }
    ).runtimeMetadata,
    { context_usage: null },
  );
  assert.deepEqual(result, {
    ok: false,
    prepareId,
    requestId,
    conversationId,
    code: "CLAUDE_PROCESS_FAILED",
  });
});

test("quiet silence wake is discarded without canonical assistant finalization", async () => {
  const { port, coordinator } = setup();
  port.preparation = prepared({
    operation: "wake",
    canonicalUserMessageId: null,
    wakeContext: {
      version: 1,
      epoch_id: userMessageId,
      slot: "post_turn_idle",
      source_user_message_id: userMessageId,
      source_head_message_id: headId,
    },
    prompt: "[09-21 周一 08:07 · wake · +7m · no reply]",
    mindPrepared: true,
  });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-wake-quiet",
    normalized_events: [
      {
        type: "text",
        payload: { text: "<quiet />" },
      },
      {
        type: "result",
        payload: {
          status: "success",
          final_text: "<quiet />",
        },
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    outcome: "wake_quiet",
    requestId,
    operation: "wake",
    conversationId,
    providerSessionId: "provider-wake-quiet",
  });
  assert.equal(port.finalizeSuccessCalls.length, 0);
  assert.equal(port.finalizeFailureCalls.length, 0);
  assert.equal(port.discardWakeCalls.length, 1);
  assert.equal((port.discardWakeCalls[0] as { failed?: boolean }).failed, undefined);
});

test("empty successful silence wake is also discarded without creating an assistant message", async () => {
  const { port, coordinator } = setup();
  port.preparation = prepared({
    operation: "wake",
    canonicalUserMessageId: null,
    wakeContext: {
      version: 1,
      epoch_id: userMessageId,
      slot: "post_turn_idle",
      source_user_message_id: userMessageId,
      source_head_message_id: headId,
    },
    prompt: "[09-21 周一 08:07 · wake · +7m · no reply]",
    mindPrepared: true,
  });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-wake-empty",
    normalized_events: [
      {
        type: "result",
        payload: {
          status: "success",
          final_text: "",
        },
      },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    outcome: "wake_quiet",
    requestId,
    operation: "wake",
    conversationId,
    providerSessionId: "provider-wake-empty",
  });
  assert.equal(port.finalizeSuccessCalls.length, 0);
  assert.equal(port.finalizeFailureCalls.length, 0);
  assert.equal(port.discardWakeCalls.length, 1);
});

test("failed silence wake is invisible and uses the same discard path", async () => {
  const { port, coordinator } = setup();
  port.preparation = prepared({
    operation: "wake",
    canonicalUserMessageId: null,
    wakeContext: {
      version: 1,
      epoch_id: userMessageId,
      slot: "long_idle",
      source_user_message_id: userMessageId,
      source_head_message_id: headId,
    },
    prompt: "[09-21 周一 09:40 · wake · +1h 40m · no reply]",
    mindPrepared: true,
  });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "ABORTED",
  });

  assert.deepEqual(result, {
    ok: true,
    outcome: "wake_failed",
    requestId,
    operation: "wake",
    conversationId,
    providerSessionId: null,
  });
  assert.equal(port.finalizeFailureCalls.length, 0);
  assert.equal(port.discardWakeCalls.length, 1);
  // Its prompt may already be in the native transcript: record it as residue.
  assert.equal((port.discardWakeCalls[0] as { failed?: boolean }).failed, true);
});

test("visible silence wake finalizes as a normal assistant continuation with no fake user message", async () => {
  const { port, coordinator } = setup();
  port.preparation = prepared({
    operation: "wake",
    canonicalUserMessageId: null,
    wakeContext: {
      version: 1,
      epoch_id: userMessageId,
      slot: "post_turn_idle",
      source_user_message_id: userMessageId,
      source_head_message_id: headId,
    },
    prompt: "[09-21 周一 08:07 · wake · +7m · no reply]",
    mindPrepared: true,
  });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-wake-visible",
    normalized_events: [
      { type: "text", payload: { text: "还想补一句。" } },
      {
        type: "result",
        payload: {
          status: "success",
          final_text: "还想补一句。",
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(port.finalizeSuccessCalls.length, 1);
  if (!result.ok || result.outcome !== "completed") {
    throw new Error("expected visible wake canonical success");
  }
  assert.equal(result.operation, "wake");
  assert.equal(result.userMessageId, null);
  assert.equal(result.providerSessionId, "provider-child");
});

test("mismatched callback identity is rejected before either finalize mutation runs", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: "99999999-9999-4999-8999-999999999999",
    conversation_id: conversationId,
    status: "failure",
    error_code: "ABORTED",
  });

  assert.deepEqual(result, {
    ok: false,
    prepareId,
    requestId: "99999999-9999-4999-8999-999999999999",
    conversationId,
    code: "RESULT_MISMATCH",
  });
  assert.equal(port.finalizeSuccessCalls.length, 0);
  assert.equal(port.finalizeFailureCalls.length, 0);
});

test("success envelope carrying normalized runtime error is recorded as protocol failure", async () => {
  const { port, coordinator } = setup();

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      {
        type: "error",
        payload: {
          code: "CONFLICTING_SESSION_ID",
          message: "private detail should not become an assistant",
        },
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(port.finalizeSuccessCalls.length, 0);
  assert.equal(port.finalizeFailureCalls.length, 1);
  const failure = port.finalizeFailureCalls[0] as { errorCode: string };
  assert.equal(failure.errorCode, "RUNTIME_PROTOCOL_ERROR");
  assert.deepEqual(result, {
    ok: false,
    prepareId,
    requestId,
    conversationId,
    code: "RUNTIME_PROTOCOL_ERROR",
  });
});

test("Mind-aware prepare persists one assembled prompt before emitting the runtime command", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.command.prompt, "ASSEMBLED_PROMPT");
  assert.equal(mind.prepareCalls.length, 1);
  assert.deepEqual(port.persistMindPreparedPromptCalls, [{
    userId,
    prepareId,
    prompt: "ASSEMBLED_PROMPT",
  }]);
});

test("Mind-aware prepare replay reuses an already assembled prompt without rebuilding context", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });
  port.prepareResult = {
    ok: true,
    outcome: "replayed",
    preparation: prepared({
      prompt: "STORED_ASSEMBLED_PROMPT",
      mindPrepared: true,
    }),
  };

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.command.prompt, "STORED_ASSEMBLED_PROMPT");
  assert.equal(mind.prepareCalls.length, 0);
  assert.equal(port.persistMindPreparedPromptCalls.length, 0);
});

test("Mind-aware prepare can recover a replay whose Mind prompt was not persisted yet", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });
  port.prepareResult = {
    ok: true,
    outcome: "replayed",
    preparation: prepared({
      prompt: "raw",
      mindPrepared: false,
    }),
  };

  const result = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.command.prompt, "ASSEMBLED_PROMPT");
  assert.equal(mind.prepareCalls.length, 1);
  assert.equal(port.persistMindPreparedPromptCalls.length, 1);
});

test("Mind-aware finalize strips hidden Mind tags before canonical write and runs post-finalize once", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });
  port.preparation = prepared({ mindPrepared: true });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      {
        type: "text",
        payload: { text: "VISIBLE <memory>remember this</memory>" },
      },
    ],
  });

  assert.equal(result.ok, true);
  const call = port.finalizeSuccessCalls[0] as {
    blocks: NativeLiveContentBlockInput[];
  };
  assert.equal(call.blocks[0]?.text, "VISIBLE");
  assert.equal(mind.parseCalls.length, 1);
  assert.equal(mind.finalizeCalls.length, 1);
});

test("durable post-finalize runner owns Mind follow-up and failures never rewrite canonical success", async () => {
  const mind = new FakeMind();
  const postFinalize = new FakePostFinalize();
  postFinalize.shouldFail = true;
  const { port, coordinator } = setup({ mind, postFinalize });
  port.preparation = prepared({ mindPrepared: true });

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      {
        type: "text",
        payload: { text: "VISIBLE <memory>remember this</memory>" },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(postFinalize.calls, [{ userId, prepareId }]);
  assert.equal(mind.finalizeCalls.length, 0);

  const call = port.finalizeSuccessCalls[0] as
    Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0];
  assert.equal(call.mindFollowUp?.intents.length, 1);
  assert.equal(call.mindFollowUp?.intents[0]?.kind, "memory");
});

test("idempotent finalize never duplicates Mind writes or branch reconciliation", async () => {
  const mind = new FakeMind();
  const { port, coordinator } = setup({ mind });
  port.preparation = prepared({ mindPrepared: true });
  port.finalizeOutcome = "idempotent";

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      { type: "text", payload: { text: "VISIBLE <memory>remember this</memory>" } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(mind.finalizeCalls.length, 0);
});

test("runtime context metadata is handed to durable finalization", async () => {
  const { port, coordinator } = setup();

  const metadata = {
    context_usage: {
      model: "claude-opus-5-5",
      total_tokens: 760000,
      max_tokens: 1000000,
      raw_max_tokens: 1000000,
      percentage: 76,
      categories: [],
    },
  };

  const result = await coordinator.finalize(userId, {
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      { type: "text", payload: { text: "READY" } },
    ],
    runtime_metadata: metadata,
  });

  assert.equal(result.ok, true);
  const call = port.finalizeSuccessCalls[0] as
    Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0];
  assert.deepEqual(call.runtimeMetadata, metadata);
});
