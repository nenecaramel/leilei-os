import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/native-live-mac-runtime-executor.js";
import type {
  NativeLiveClaudeRuntime,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const prepareId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";

function command(
  input: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "hello",
    ...input,
  };
}

test("new command invokes sendNew and returns a correlated success envelope", async () => {
  const calls: unknown[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew(prompt) {
      calls.push(["new", prompt]);
      return {
        providerSessionId: "provider-new",
        normalizedEvents: [
          { type: "result", payload: { status: "success", final_text: "READY" } },
        ],
      };
    },
    async resume() { throw new Error("resume must not be used"); },
    async fork() { throw new Error("fork must not be used"); },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.deepEqual(calls, [["new", "hello"]]);
  assert.deepEqual(result, {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-new",
    normalized_events: [
      { type: "result", payload: { status: "success", final_text: "READY" } },
    ],
  });
});

test("fork command invokes fork with the exact prepared parent session and never resume", async () => {
  const calls: unknown[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("new must not be used"); },
    async resume() { throw new Error("resume must not be used"); },
    async fork(sessionId, prompt) {
      calls.push(["fork", sessionId, prompt]);
      return {
        providerSessionId: "provider-child",
        normalizedEvents: [],
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      runtime_mode: "fork",
      parent_provider_session_id: "provider-parent",
    }),
  );

  assert.deepEqual(calls, [["fork", "provider-parent", "hello"]]);
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(result.provider_session_id, "provider-child");
});

test("missing provider session returns a safe NO_PROVIDER_SESSION failure", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      return { providerSessionId: null, normalizedEvents: [] };
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.deepEqual(result, {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "NO_PROVIDER_SESSION",
  });
});

test("fork provider-session reuse fails closed before returning success", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() {
      return {
        providerSessionId: "provider-parent",
        normalizedEvents: [],
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      runtime_mode: "fork",
      parent_provider_session_id: "provider-parent",
    }),
  );

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "PROVIDER_SESSION_CONFLICT");
});

test("tagged local transport failures map to their bounded runtime code without leaking details", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      throw Object.assign(new Error("private /Users/Admin1 path"), {
        runtimeCode: "MALFORMED_STREAM",
        stderr: "private stderr",
      });
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.deepEqual(result, {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "MALFORMED_STREAM",
  });
  assert.doesNotMatch(JSON.stringify(result), /Admin1|stderr|private/);
});

test("unknown runtime exceptions collapse to RUNTIME_UNAVAILABLE", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("socket vanished"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "RUNTIME_UNAVAILABLE");
});
