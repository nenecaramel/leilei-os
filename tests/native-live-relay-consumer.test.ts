import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRelayConsumer,
  type NativeLiveRelayBranchExecutor,
  type NativeLiveRelayConversationReader,
  type NativeLiveRelaySendExecutor,
} from "../src/domains/bridge/native-live-relay-consumer.js";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../src/domains/conversation/native-live-conversation-types.js";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const headId = "33333333-3333-4333-8333-333333333333";
const targetUserId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-21T00:00:00.000Z";

function conversation(
  currentHeadMessageId: string | null = headId,
): NativeLiveConversation {
  return {
    id: conversationId,
    userId,
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  parentMessageId: string | null,
): NativeLiveMessage {
  return {
    id,
    conversationId,
    parentMessageId,
    role,
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [],
  };
}

function checkpoint(
  id = "55555555-5555-4555-8555-555555555555",
): NativeLiveProviderCheckpoint {
  return {
    id,
    conversationId,
    canonicalMessageId: "66666666-6666-4666-8666-666666666666",
    provider: "claude_code",
    providerSessionId: "provider-session-1",
    providerCheckpointId: null,
    createdAt: now,
  };
}

class FakeReader implements NativeLiveRelayConversationReader {
  value: NativeLiveConversation | null = conversation();
  calls: unknown[] = [];

  async getConversation(input: unknown): Promise<NativeLiveConversation | null> {
    this.calls.push(input);
    return this.value;
  }
}

class FakeSend implements NativeLiveRelaySendExecutor {
  calls: unknown[] = [];

  async send(input: unknown) {
    this.calls.push(input);
    return {
      ok: true as const,
      userMessage: message(
        "77777777-7777-4777-8777-777777777777",
        "user",
        headId,
      ),
      assistantMessage: message(
        "88888888-8888-4888-8888-888888888888",
        "assistant",
        "77777777-7777-4777-8777-777777777777",
      ),
      checkpoint: checkpoint(),
      normalizedEvents: [],
    };
  }
}

class FakeBranch implements NativeLiveRelayBranchExecutor {
  retryCalls: unknown[] = [];
  editCalls: unknown[] = [];

  async retry(input: unknown) {
    this.retryCalls.push(input);
    return {
      ok: true as const,
      userMessage: message(targetUserId, "user", headId),
      assistantMessage: message(
        "99999999-9999-4999-8999-999999999999",
        "assistant",
        targetUserId,
      ),
      checkpoint: checkpoint(),
      normalizedEvents: [],
    };
  }

  async edit(input: unknown) {
    this.editCalls.push(input);
    return {
      ok: true as const,
      userMessage: message(
        "10101010-1010-4010-8010-101010101010",
        "user",
        headId,
      ),
      assistantMessage: message(
        "12121212-1212-4212-8212-121212121212",
        "assistant",
        "10101010-1010-4010-8010-101010101010",
      ),
      checkpoint: checkpoint(),
      normalizedEvents: [],
    };
  }
}

function setup() {
  const reader = new FakeReader();
  const send = new FakeSend();
  const branch = new FakeBranch();
  const consumer = new NativeLiveRelayConsumer(reader, send, branch);
  return { reader, send, branch, consumer };
}

test("send executes only when expected head matches canonical head", async () => {
  const { send, consumer } = setup();
  const result = await consumer.consume(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(send.calls, [{
    userId,
    conversationId,
    text: "hello",
  }]);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.requestId, requestId);
  assert.equal(result.providerSessionId, "provider-session-1");
});

test("stale send is rejected before the send orchestrator can append a user row", async () => {
  const { reader, send, consumer } = setup();
  reader.value = conversation(
    "13131313-1313-4313-8313-131313131313",
  );

  const result = await consumer.consume(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    expected_head_message_id: headId,
    text: "stale",
  });

  assert.deepEqual(send.calls, []);
  assert.deepEqual(result, {
    ok: false,
    requestId,
    operation: "send",
    conversationId,
    code: "STALE_HEAD",
    currentHeadMessageId: "13131313-1313-4313-8313-131313131313",
  });
});

test("retry delegates the exact historical user branch point", async () => {
  const { branch, consumer } = setup();

  const result = await consumer.consume(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "retry",
    conversation_id: conversationId,
    target_user_message_id: targetUserId,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(branch.retryCalls, [{
    userId,
    conversationId,
    targetUserMessageId: targetUserId,
  }]);
});

test("edit delegates branch point and replacement text", async () => {
  const { branch, consumer } = setup();

  const result = await consumer.consume(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "edit",
    conversation_id: conversationId,
    target_user_message_id: targetUserId,
    text: "replacement",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(branch.editCalls, [{
    userId,
    conversationId,
    targetUserMessageId: targetUserId,
    text: "replacement",
  }]);
});

test("orchestrator failure is returned as a stable relay failure with request identity", async () => {
  const { send, consumer } = setup();
  send.send = async () => ({
    ok: false as const,
    userMessage: message(
      "77777777-7777-4777-8777-777777777777",
      "user",
      headId,
    ),
    code: "RUNTIME_FAILURE" as const,
    message: "private runtime details",
    normalizedEvents: [],
  });

  const result = await consumer.consume(userId, {
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
    code: "RUNTIME_FAILURE",
  });
});

test("malformed relay payload fails closed without invoking any orchestrator", async () => {
  const { send, branch, consumer } = setup();

  const result = await consumer.consume(userId, {
    dispatch_target: "chatgpt_host",
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
    code: "INVALID_REQUEST",
  });
  assert.deepEqual(send.calls, []);
  assert.deepEqual(branch.retryCalls, []);
  assert.deepEqual(branch.editCalls, []);
});


test("missing canonical checkpoint maps to the stable relay CHECKPOINT_NOT_FOUND code", async () => {
  const { send, consumer } = setup();
  send.send = async () => ({
    ok: false as const,
    userMessage: message(
      "77777777-7777-4777-8777-777777777777",
      "user",
      headId,
    ),
    code: "CANONICAL_CHECKPOINT_MISSING" as const,
    message: "internal checkpoint detail",
    normalizedEvents: [],
  });

  const result = await consumer.consume(userId, {
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
    code: "CHECKPOINT_NOT_FOUND",
  });
});
