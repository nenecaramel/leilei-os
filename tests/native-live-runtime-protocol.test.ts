import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveRuntimeProtocolError,
  assertRuntimeResultMatchesCommand,
  parseNativeLiveRuntimeCommand,
  parseNativeLiveRuntimeExecutionResult,
} from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";

const prepareId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const userMessageId = "44444444-4444-4444-8444-444444444444";

const resultTelemetry = {
  subtype: "error_during_execution",
  is_error: true,
  duration_ms: 3210,
  duration_api_ms: 2100,
  num_turns: 3,
  queued_turn_count: 1,
  stop_reason: "end_turn",
  terminal_reason: "api_error",
  api_error_status: 529,
  startup_failure_reason: null,
  fast_mode_state: "off",
  fast_mode_disabled_reason: "policy",
  total_cost_usd: 0.42,
  origin: { kind: "user" },
  usage: {
    input_tokens: 12,
    output_tokens: 7,
    output_tokens_details: {
      thinking_tokens: 5,
    },
  },
  modelUsage: {
    "claude-opus-5-5": {
      inputTokens: 12,
      outputTokens: 7,
      thinkingTokens: 5,
      costUSD: 0.42,
    },
  },
  permission_denials: [{
    tool_name: "Write",
    tool_use_id: "tool-denied",
    tool_input: { file_path: "/tmp/nope" },
  }],
  errors: ["overloaded"],
  structured_output_present: false,
  deferred_tool_use_present: false,
  latency: {
    ttft_ms: 400,
    ttft_stream_ms: 450,
    time_to_request_ms: 120,
    time_to_request_from_spawn_ms: 140,
    time_origin_ms: 123456,
    warm_spare_claimed: true,
    first_content_frame_ms: 390,
    first_stream_post_ms: 430,
    first_stream_post_ack_ms: 440,
    first_stream_post_wall_ms: 445,
    first_text_post_ms: 460,
    first_text_post_wall_ms: 470,
    first_stream_post_queue_wait_ms: 11,
    first_stream_post_queued_behind: 2,
  },
};

test("new runtime command carries no parent provider session", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
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

test("runtime protocol v4 carries bounded attachment descriptors", () => {
  const attachmentId = "55555555-5555-4555-8555-555555555555";
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    attachments: [{
      attachment_id: attachmentId,
      filename: "photo.jpg",
      mime_type: "image/jpeg",
      size_bytes: 1234,
      sha256: "a".repeat(64),
      kind: "image",
    }],
    prompt: "see attachment",
  });

  assert.equal(command.protocol_version, 4);
  assert.deepEqual(command.attachments, [{
    attachment_id: attachmentId,
    filename: "photo.jpg",
    mime_type: "image/jpeg",
    size_bytes: 1234,
    sha256: "a".repeat(64),
    kind: "image",
  }]);

  assert.throws(
    () => parseNativeLiveRuntimeCommand({
      ...command,
      protocol_version: 1,
    }),
    /Unsupported runtime protocol version/u,
  );

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "ATTACHMENT_UNAVAILABLE",
  });
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );
});

test("silence wake runtime command carries no fake canonical user message", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "wake",
    conversation_id: conversationId,
    canonical_user_message_id: null,
    runtime_mode: "fork",
    parent_provider_session_id: "provider-parent",
    prompt: "[10-04 周日 11:47 · wake · +1h 47m · no reply]",
  });

  assert.equal(command.operation, "wake");
  assert.equal(command.canonical_user_message_id, null);
  assert.equal(command.parent_provider_session_id, "provider-parent");

  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        ...command,
        canonical_user_message_id: userMessageId,
      }),
    /must not include a canonical user message/u,
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        ...command,
        operation: "send",
        canonical_user_message_id: null,
        runtime_mode: "new",
        parent_provider_session_id: null,
      }),
    /canonical_user_message_id/u,
  );
});

test("fork runtime command requires an exact parent provider session", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
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
    protocol_version: 4,
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

test("runtime command accepts Sonnet 5.5 native between_tools thinking", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    execution_selection: {
      model: "claude-sonnet-5-5",
      thinking: "between_tools",
      effort: "high",
    },
    prompt: "hello",
  });

  assert.deepEqual(command.execution_selection, {
    model: "claude-sonnet-5-5",
    thinking: "between_tools",
    effort: "high",
  });

  assert.throws(
    () =>
      parseNativeLiveRuntimeCommand({
        ...command,
        execution_selection: {
          model: "claude-sonnet-5-5",
          thinking: "between_tools",
          effort: "xhigh",
        },
      }),
    /only supported up to effort=high/i,
  );
});

test("runtime protocol preserves the durable working directory and enforces the bound path", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    expected_working_directory: "/Users/leilei/Projects/demo",
    prompt: "hello",
  });
  assert.equal(
    command.expected_working_directory,
    "/Users/leilei/Projects/demo",
  );

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    effective_working_directory: "/Users/leilei/Projects/demo",
    normalized_events: [],
  });
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );

  const moved = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    effective_working_directory: "/Users/leilei/Projects/moved",
    normalized_events: [],
  });
  assert.throws(
    () => assertRuntimeResultMatchesCommand(command, moved),
    /working directory does not match/u,
  );
});

test("runtime protocol defaults an absent expected directory for new sessions", () => {
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
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
  assert.equal(command.expected_working_directory, null);

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-legacy",
    normalized_events: [],
  });
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(result.effective_working_directory, null);
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );
});

test("success result carries provider session and normalized events only", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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

test("runtime metadata preserves Agent SDK result usage, thinking, permission and latency telemetry", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    effective_working_directory: null,
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      result: resultTelemetry,
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(
    result.runtime_metadata?.result,
    resultTelemetry,
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "success",
        provider_session_id: "provider-child",
        normalized_events: [],
        runtime_metadata: {
          context_usage: null,
          result: {
            ...resultTelemetry,
            permission_denials:
              Array.from({ length: 65 }, () =>
                resultTelemetry.permission_denials[0]
              ),
          },
        },
      }),
    /permission_denials must contain at most 64 items/,
  );
});

test("runtime metadata preserves bounded VCS mutation hints", () => {
  const vcsChanges = [
    {
      mutation_kind: "commit",
      cwd: "/workspace/repo",
      branch: "main",
    },
    {
      mutation_kind: "push",
      cwd: "/workspace/repo/subdir",
      branch: null,
    },
  ];

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-vcs",
    effective_working_directory: "/workspace/repo",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      vcs_changes: vcsChanges,
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(
    result.runtime_metadata?.vcs_changes,
    vcsChanges,
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "failure",
        error_code: "CLAUDE_PROCESS_FAILED",
        runtime_metadata: {
          context_usage: null,
          vcs_changes: [{
            mutation_kind: "",
            cwd: "/workspace/repo",
            branch: null,
          }],
        },
      }),
    /vcs_changes\[0\]\.mutation_kind/,
  );
});

test("runtime metadata preserves bounded SessionStore mirror health", () => {
  const sessionStore = {
    provider: "claude_agent_sdk" as const,
    configured: true,
    mode: "fork" as const,
    session_id: "provider-child",
    parent_session_id: "provider-parent",
    project_key: "/workspace/leilei-os",
    cwd: "/workspace/leilei-os",
    parent_local_available: false,
    parent_status_before: "complete" as const,
    backfill_status: "not_needed" as const,
    backfill_failure_reason: null,
    mirror_status: "error" as const,
    mirror_failure_reason: "remote append failed",
    status_after: "incomplete" as const,
    status_failure_reason: null,
  };
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    effective_working_directory: "/workspace/leilei-os",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      session_store: sessionStore,
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(
    result.runtime_metadata?.session_store,
    sessionStore,
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "failure",
        error_code: "CLAUDE_PROCESS_FAILED",
        runtime_metadata: {
          context_usage: null,
          session_store: {
            ...sessionStore,
            status_after: "maybe",
          },
        },
      }),
    /session_store\.status_after is invalid/,
  );
});

test("runtime metadata accepts bounded durable MCP output resources", () => {
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-child",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      output_resources: [{
        source: "tool_result",
        tool_use_id: "tool-resource",
        task_id: null,
        uri: "mcp://exports/report.pdf",
        name: "report.pdf",
        title: "Report",
        description: "Generated report",
        mime_type: "application/pdf",
        size: 12345,
        annotations: {
          audience: ["user"],
        },
        metadata: {
          source: "mcp",
        },
      }],
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(
    result.runtime_metadata?.output_resources,
    [{
      source: "tool_result",
      tool_use_id: "tool-resource",
      task_id: null,
      uri: "mcp://exports/report.pdf",
      name: "report.pdf",
      title: "Report",
      description: "Generated report",
      mime_type: "application/pdf",
      size: 12345,
      annotations: {
        audience: ["user"],
      },
      metadata: {
        source: "mcp",
      },
    }],
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
        prepare_id: prepareId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "success",
        provider_session_id: "provider-child",
        normalized_events: [],
        runtime_metadata: {
          context_usage: null,
          output_resources: [{
            source: "unknown",
            tool_use_id: null,
            task_id: null,
            uri: "mcp://exports/report.pdf",
            name: null,
            title: null,
            description: null,
            mime_type: null,
            size: null,
            annotations: null,
            metadata: null,
          }],
        },
      }),
    /output_resources\[0\]\.source is invalid/,
  );
});

test("runtime metadata rejects unbounded execution readback errors", () => {
  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
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

test("failure result accepts bounded result telemetry without exposing arbitrary fields", () => {
  assert.deepEqual(
    parseNativeLiveRuntimeExecutionResult({
      protocol_version: 4,
      prepare_id: prepareId,
      request_id: requestId,
      conversation_id: conversationId,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    }),
    {
      protocol_version: 4,
      prepare_id: prepareId,
      request_id: requestId,
      conversation_id: conversationId,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    },
  );

  const withTelemetry = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "CLAUDE_PROCESS_FAILED",
    runtime_metadata: {
      context_usage: null,
      result: resultTelemetry,
    },
  });
  assert.equal(withTelemetry.status, "failure");
  if (withTelemetry.status !== "failure") {
    throw new Error("expected failure");
  }
  assert.equal(
    withTelemetry.runtime_metadata?.result?.terminal_reason,
    "api_error",
  );
  assert.deepEqual(
    withTelemetry.runtime_metadata?.result?.modelUsage?.[
      "claude-opus-5-5"
    ],
    resultTelemetry.modelUsage["claude-opus-5-5"],
  );

  assert.throws(
    () =>
      parseNativeLiveRuntimeExecutionResult({
        protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
        protocol_version: 5,
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
        protocol_version: 4,
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

test("runtime protocol v4 carries explicit output attachment ids", () => {
  const outputAttachmentId =
    "66666666-6666-4666-8666-666666666666";
  const command = parseNativeLiveRuntimeCommand({
    protocol_version: 4,
    dispatch_target: "claude_code",
    prepare_id: prepareId,
    request_id: requestId,
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: userMessageId,
    runtime_mode: "new",
    parent_provider_session_id: null,
    prompt: "make a file",
  });
  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-output",
    effective_working_directory: "/workspace",
    normalized_events: [],
    output_attachment_ids: [outputAttachmentId],
  });

  assert.deepEqual(
    result.status === "success"
      ? result.output_attachment_ids
      : null,
    [outputAttachmentId],
  );
  assert.doesNotThrow(() =>
    assertRuntimeResultMatchesCommand(command, result)
  );

  assert.throws(
    () => parseNativeLiveRuntimeExecutionResult({
      ...result,
      protocol_version: 3,
    }),
    /Unsupported runtime protocol version/u,
  );
});

test("runtime metadata accepts the bounded system/init environment projection", () => {
  const environment = {
    model: "claude-sonnet-5-5",
    cwd: "/workspace",
    tools: ["Read"],
    mcp_servers: [{ name: "leileios", status: "connected", source: null }],
    permission_mode: "default",
    slash_commands: ["/compact"],
    terminal_slash_commands: [],
    api_key_source: "subscription",
    output_style: "default",
    agents: ["Explore"],
    betas: [],
    claude_code_version: "2.1.267",
    sdk_version: "0.3.283",
    skills: ["pdfs"],
    plugins: [{ name: "superpowers", path: "/plugin" }],
    plugin_errors: [{
      plugin: "broken",
      type: "load_error",
      message: "failed",
      path: "/broken",
    }],
    effort: "high",
    capabilities: ["interrupt_receipt_v1"],
    fast_mode: { state: "off", disabled_reason: null },
  };

  const result = parseNativeLiveRuntimeExecutionResult({
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-init",
    normalized_events: [],
    runtime_metadata: {
      context_usage: null,
      environment,
    },
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata?.environment, environment);

  assert.throws(
    () => parseNativeLiveRuntimeExecutionResult({
      ...result,
      runtime_metadata: {
        context_usage: null,
        environment: {
          ...environment,
          arbitrary_raw_payload: "forbidden",
        },
      },
    }),
    /Unexpected runtime protocol field: arbitrary_raw_payload/,
  );
});

test('v4 resume uses exact parent checkpoint and keeps session identity',()=>{
 const command=parseNativeLiveRuntimeCommand({protocol_version:4,dispatch_target:'claude_code',prepare_id:prepareId,request_id:requestId,operation:'send',conversation_id:conversationId,canonical_user_message_id:userMessageId,runtime_mode:'resume',parent_provider_session_id:'A',parent_provider_checkpoint_id:requestId,prompt:'next'});
 assert.equal(command.runtime_mode,'resume');
 const result=parseNativeLiveRuntimeExecutionResult({protocol_version:4,prepare_id:prepareId,request_id:requestId,conversation_id:conversationId,status:'success',provider_session_id:'A',provider_checkpoint_id:prepareId,normalized_events:[]});
 assert.doesNotThrow(()=>assertRuntimeResultMatchesCommand(command,result));
 assert.throws(()=>assertRuntimeResultMatchesCommand(command,{...result,provider_session_id:'B'}),/session/i);
 assert.throws(()=>parseNativeLiveRuntimeCommand({...command,parent_provider_checkpoint_id:null}),/checkpoint/i);
 assert.throws(()=>parseNativeLiveRuntimeExecutionResult({...result,provider_checkpoint_id:undefined}),/checkpoint/i);
});
test('v4 exact fork carries historical UUID; legacy whole-session fork stays explicit',()=>{
 const shape={protocol_version:4,dispatch_target:'claude_code',prepare_id:prepareId,request_id:requestId,operation:'retry',conversation_id:conversationId,canonical_user_message_id:userMessageId,runtime_mode:'fork',parent_provider_session_id:'A',parent_provider_checkpoint_id:requestId,prompt:'again'};
 assert.equal(parseNativeLiveRuntimeCommand(shape).parent_provider_checkpoint_id,requestId);
 assert.equal(parseNativeLiveRuntimeCommand({...shape,parent_provider_checkpoint_id:null}).parent_provider_checkpoint_id,null);
 assert.throws(()=>parseNativeLiveRuntimeCommand({...shape,protocol_version:3}),/checkpoint|protocol/i);
 assert.throws(()=>parseNativeLiveRuntimeCommand({...shape,runtime_mode:'new',parent_provider_session_id:null}),/checkpoint/i);
});

test('failed native input receipts are bounded exact UUIDs exclusive to checkpoint resume', () => {
  const base = { protocol_version: 4, dispatch_target: 'claude_code', prepare_id: prepareId,
    request_id: requestId, conversation_id: conversationId, canonical_user_message_id: userMessageId,
    operation: 'send', runtime_mode: 'resume', parent_provider_session_id: conversationId,
    parent_provider_checkpoint_id: requestId, prompt: 'synthetic' };
  assert.deepEqual(parseNativeLiveRuntimeCommand({ ...base, failed_user_message_uuids: [prepareId] }).failed_user_message_uuids, [prepareId]);
  for (const patch of [
    {failed_user_message_uuids: [userMessageId]}, {failed_user_message_uuids: [prepareId, prepareId]},
    {failed_user_message_uuids: ['invalid']}, {failed_user_message_uuids: Array(65).fill(prepareId)},
    {runtime_mode: 'fork', failed_user_message_uuids: [prepareId]},
    {failed_user_message_uuids: 'invalid'},
  ]) assert.throws(() => parseNativeLiveRuntimeCommand({...base,...patch}), NativeLiveRuntimeProtocolError);
  assert.equal(Object.hasOwn(parseNativeLiveRuntimeCommand(base), 'failed_user_message_uuids'), false);
});

test('checkpoint-addressed wake can resume the same session without a fabricated user message',()=>{
 const shape={protocol_version:4,dispatch_target:'claude_code',prepare_id:prepareId,request_id:requestId,operation:'wake',conversation_id:conversationId,canonical_user_message_id:null,runtime_mode:'resume',parent_provider_session_id:'wake-parent',parent_provider_checkpoint_id:requestId,prompt:'synthetic wake'};
 const command=parseNativeLiveRuntimeCommand(shape);assert.equal(command.runtime_mode,'resume');assert.equal(command.canonical_user_message_id,null);
 assert.throws(()=>parseNativeLiveRuntimeCommand({...shape,parent_provider_checkpoint_id:null}),/checkpoint/);
 assert.throws(()=>parseNativeLiveRuntimeCommand({...shape,canonical_user_message_id:userMessageId}),/canonical user/);
 const result=parseNativeLiveRuntimeExecutionResult({protocol_version:4,prepare_id:prepareId,request_id:requestId,conversation_id:conversationId,status:'success',provider_session_id:'wake-parent',provider_checkpoint_id:prepareId,normalized_events:[]});
 assert.doesNotThrow(()=>assertRuntimeResultMatchesCommand(command,result));
 assert.throws(()=>assertRuntimeResultMatchesCommand(command,{...result,provider_session_id:'foreign'}),/session identity/);
});
