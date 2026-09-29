import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRuntimeProtocolError,
  assertRuntimeResultMatchesCommand,
  parseNativeLiveRuntimeCommand,
  parseNativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/native-live-runtime-protocol.js";

const prepareId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";

test("new runtime command carries no parent provider session", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "  hello  ",
  });

  assert.equal(command.prompt, "hello");
  assert.equal(command.parent_provider_session_id, null);
});

test("fork runtime command requires an exact parent provider session", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "edit",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "fork",
    parent_provider_session_id: "provider-parent",
    prompt: "edited",
  });
  assert.equal(command.parent_provider_session_id, "provider-parent");

  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        ...command,
        parent_provider_session_id: null,
      }),
    /requires a parent provider session/,
  );
});

test("runtime command carries optional validated execution selection", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    execution_selection: {
      model: "claude-sonnet-5",
      thinking: "adaptive",
      effort: "xhigh",
    },
    prompt: "hello",
  });

  assert.deepEqual(command.execution_selection, {
    model: "claude-sonnet-5",
    thinking: "adaptive",
    effort: "xhigh",
  });
});


test("runtime protocol preserves Workspace identity and enforces the bound root", () => {
  const workspaceId = "55555555-5555-4555-8555-555555555555";
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    workspace_id: workspaceId,
    expected_workspace_root: "/Users/leilei/Projects/demo",
    prompt: "hello",
  });
  assert.equal(command.workspace_id, workspaceId);
  assert.equal(
    command.expected_workspace_root,
    "/Users/leilei/Projects/demo",
  );

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    workspace_id: workspaceId,
    effective_workspace_root: "/Users/leilei/Projects/demo",
    normalized_events: [],
  });
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );

  const moved = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    workspace_id: workspaceId,
    effective_workspace_root: "/Users/leilei/Projects/moved",
    normalized_events: [],
  });
  assert.throws(
    () => assertRuntimeResultMatchesCommand(command, moved),
    /workspace root does not match/u,
  );
});

test("runtime protocol accepts legacy envelopes only for unbound turns", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "legacy",
  });
  assert.equal(command.workspace_id, null);
  assert.equal(command.expected_workspace_root, null);

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-legacy",
    normalized_events: [],
  });
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(result.workspace_id, null);
  assert.equal(result.effective_workspace_root, null);
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );
});

test("success result carries provider session and normalized events only", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [
      { type: "result", payload: { status: "success", final_text: "READY" } },
    ],
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(result.provider_session_id, "provider-child");
  assert.equal(result.normalized_events.length, 1);
});

test("success result accepts bounded runtime context usage", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [],
    runtime_metadata: {
      context_usage: {
        model: "claude-opus-5-5",
        total_tokens: 760000,
        max_tokens: 1000000,
        raw_max_tokens: 1000000,
        percentage: 76,
        categories: [{
          name: "Messages",
          tokens: 700000,
          kind: "used",
          is_deferred: false,
        }],
      },
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(
    result.runtime_metadata?.context_usage?.percentage,
    76,
  );
});

test("runtime metadata accepts bounded execution readback while remaining backward compatible", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      execution: {
        readback: {
          requested: {
            model: "claude-opus-5-5",
            thinking: "adaptive",
            effort: "medium",
          },
          applied: {
            model: "claude-opus-5-5",
            effort: "medium",
          },
          capability: null,
        },
        readback_error: null,
      },
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(
    result.runtime_metadata?.execution?.readback.applied.model,
    "claude-opus-5-5",
  );

  const legacy = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
    },
  });
  assert.equal(legacy.status, "success");
  if (legacy.status !== "success") throw new Error("expected success");
  assert.equal(
    Object.hasOwn(
      legacy.runtime_metadata ?? {},
      "execution",
    ),
    false,
  );
});

test("runtime metadata rejects unbounded execution readback errors", () => {
  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 1,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "success",
        provider_session_id: "provider-child",
        normalized_events: [],
        runtime_metadata: {
          context_usage: null,
          execution: {
            readback: {
              requested: null,
              applied: {
                model: null,
                effort: null,
              },
              capability: null,
            },
            readback_error: "private raw error",
          },
        },
      }),
    /execution\.readback_error is invalid/,
  );
});

test("failure result exposes only a bounded safe error code", () => {
  assert.deepEqual(
    parseNativeLiveRuntimeExecutionResult({
      protocol_version: 1,
      prepare_id: prepareId,
      request_id: requestId,
      conversation_id: conversationId,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    }),
    {
      protocol_version: 1,
      prepare_id: prepareId,
      request_id: requestId,
      conversation_id: conversationId,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    },
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 1,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "failure",
        error_code: "CLAUDE_PROCESS_FAILED",
        stderr: "private local path",
      }),
    /Unexpected runtime protocol field: stderr/,
  );
});

test("graceful interrupt is a bounded runtime failure code", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "INTERRUPTED",
  });

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "INTERRUPTED");
});

test("result identity must match the exact prepared command", () => {
  const command = parseNativeLiveRuntimeCommand({
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
  });

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: "55555555-5555-4555-8555-555555555555",
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "ABORTED",
  });

  assert.throws(
    () => assertRuntimeResultMatchesCommand(command, result),
    /does not match the prepared command identity/,
  );
});

test("fork result cannot reuse the parent provider session", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "retry",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "fork",
    parent_provider_session_id: "provider-parent",
    prompt: "retry",
  });

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-parent",
    normalized_events: [],
  });

  assert.throws(
    () => assertRuntimeResultMatchesCommand(command, result),
    /must use a new provider session id/,
  );
});

test("assembled Mind prompt may exceed raw user-text limit while remaining bounded", () => {
  const prompt = "x".repeat(8_000);
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt,
  });
  assert.equal(command.prompt.length, 8_000);

  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        ...command,
        prompt: "x".repeat(16_001),
      }),
    /between 1 and 16000 characters/u,
  );
});

test("protocol rejects unknown versions and extra fields", () => {
  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        protocol_version: 2,
        dispatch_target: "claude_code",
        prepare_id: prepareId,
        request_id: requestId,
        operation: "send",
        conversation_id: conversationId,
        canonical_user_message_id: userMessageId,
        runtime_mode: "new",
        parent_provider_session_id: null,
        prompt: "hello",
      }),
    NativeLiveRuntimeProtocolError,
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 1,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "success",
        provider_session_id: "provider-child",
        normalized_events: [],
        raw_stdout: "forbidden",
      }),
    /Unexpected runtime protocol field: raw_stdout/,
  );
});
