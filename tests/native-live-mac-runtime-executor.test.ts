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

const resultTelemetry = {
  subtype: "success",
  is_error: false,
  duration_ms: 2500,
  duration_api_ms: 1800,
  num_turns: 2,
  queued_turn_count: 0,
  stop_reason: "end_turn",
  terminal_reason: "completed",
  api_error_status: null,
  startup_failure_reason: null,
  fast_mode_state: "off",
  fast_mode_disabled_reason: null,
  total_cost_usd: 0.25,
  origin: { kind: "user" },
  usage: {
    input_tokens: 11,
    output_tokens: 9,
    output_tokens_details: {
      thinking_tokens: 6,
    },
  },
  modelUsage: {
    "claude-opus-5-5": {
      inputTokens: 11,
      outputTokens: 9,
      thinkingTokens: 6,
      costUSD: 0.25,
    },
  },
  permission_denials: [],
  errors: [],
  structured_output_present: false,
  deferred_tool_use_present: false,
  latency: {
    ttft_ms: 300,
    ttft_stream_ms: 320,
    time_to_request_ms: 100,
    time_to_request_from_spawn_ms: 120,
    time_origin_ms: 123456,
    warm_spare_claimed: false,
    first_content_frame_ms: 290,
    first_stream_post_ms: 310,
    first_stream_post_ack_ms: 315,
    first_stream_post_wall_ms: 318,
    first_text_post_ms: 330,
    first_text_post_wall_ms: 335,
    first_stream_post_queue_wait_ms: 7,
    first_stream_post_queued_behind: 1,
  },
};

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
    workspace_id: null,
    expected_workspace_root: null,
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
    workspace_id: null,
    effective_workspace_root: "/",
    normalized_events: [
      { type: "result", payload: { status: "success", final_text: "READY" } },
    ],
  });
});

test("terminal result excludes runtime-only duplicate events but preserves canonical fallback events", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      return {
        providerSessionId: "provider-new",
        normalizedEvents: [
          {
            type: "session",
            payload: {
              provider_session_id: "provider-new",
            },
          },
          {
            type: "partial_text",
            payload: { delta: "he" },
          },
          {
            type: "runtime",
            payload: { kind: "session_state_changed", state: "running" },
          },
          {
            type: "task",
            payload: { phase: "progress" },
          },
          {
            type: "tool_use",
            payload: {
              tool_use_id: "tu-1",
              tool_name: "Read",
              input: { file_path: "a.txt" },
            },
          },
          {
            type: "tool_result",
            payload: {
              tool_use_id: "tu-1",
              output: "contents",
              is_error: false,
            },
          },
          {
            type: "text",
            payload: {
              role: "assistant",
              text: "READY",
              final: false,
            },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: "READY",
            },
          },
        ],
      };
    },
    async resume() { throw new Error("resume must not be used"); },
    async fork() { throw new Error("fork must not be used"); },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(
    result.normalized_events.map((event) => event.type),
    ["tool_use", "tool_result", "text", "result"],
  );
});

test("durably projects Agent SDK result telemetry without changing canonical fallback events", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      return {
        providerSessionId: "provider-telemetry",
        normalizedEvents: [{
          type: "result",
          payload: {
            status: "success",
            final_text: "READY",
            duration_ms: 2500,
            telemetry: resultTelemetry,
          },
        }],
      };
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    result: resultTelemetry,
  });
  assert.equal(
    result.normalized_events[0]?.payload?.final_text,
    "READY",
  );
});

test("provider terminal failures retain bounded result telemetry in the failure envelope", async () => {
  const failureTelemetry = {
    ...resultTelemetry,
    subtype: "error_max_budget_usd",
    is_error: true,
    terminal_reason: "budget_exhausted",
    stop_reason: null,
    errors: ["budget exhausted"],
  };
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      throw Object.assign(
        new Error("Claude Agent SDK turn failed."),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          normalizedEvents: [{
            type: "result",
            payload: {
              status: "error",
              final_text: "PRIVATE FINAL TEXT",
              duration_ms: 2500,
              telemetry: failureTelemetry,
            },
          }],
        },
      );
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "failure");
  if (result.status !== "failure") {
    throw new Error("expected failure");
  }
  assert.equal(result.error_code, "CLAUDE_PROCESS_FAILED");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    result: failureTelemetry,
  });
  assert.doesNotMatch(
    JSON.stringify(result.runtime_metadata),
    /PRIVATE FINAL TEXT/,
  );
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

test("fork propagates missing local parent session as NO_PROVIDER_SESSION", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() {
      throw Object.assign(
        new Error("local parent transcript missing"),
        { runtimeCode: "NO_PROVIDER_SESSION" },
      );
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      runtime_mode: "fork",
      parent_provider_session_id: "provider-parent",
    }),
  );

  assert.deepEqual(result, {
    protocol_version: 1,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "failure",
    error_code: "NO_PROVIDER_SESSION",
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /local parent transcript missing/,
  );
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

test("runtime failure diagnostics expose bounded Agent SDK cause without leaking prompt payloads", async () => {
  const diagnostics: unknown[] = [];
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      throw Object.assign(
        new Error("Claude Agent SDK turn failed: provider stream ended"),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          providerSessionId: "provider-debug",
          cause: Object.assign(
            new Error(
              "socket closed under /Users/Admin1/Developer/leilei-os-main with sk-secretsecret",
            ),
            { code: "ECONNRESET" },
          ),
          result: {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            errors: [
              "upstream disconnected",
              "Bearer abc.def.ghi",
            ],
          },
          events: [
            { type: "system", subtype: "init" },
            { type: "assistant" },
            {
              type: "user",
              message: "PRIVATE PROMPT MUST NOT BE LOGGED",
            },
            {
              type: "result",
              subtype: "error_during_execution",
            },
          ],
          normalizedEvents: [
            {
              type: "partial_text",
              payload: {
                delta: "PRIVATE MODEL TEXT MUST NOT BE LOGGED",
              },
            },
            {
              type: "result",
              payload: {
                final_text: "PRIVATE FINAL TEXT MUST NOT BE LOGGED",
              },
            },
          ],
          stderr: "PRIVATE STDERR MUST NOT BE LOGGED",
        },
      );
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/",
    null,
    null,
    (value) => diagnostics.push(value),
  ).execute(command());

  assert.equal(result.status, "failure");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    prepareId,
    runtimeCode: "CLAUDE_PROCESS_FAILED",
    errorName: "Error",
    errorMessage:
      "Claude Agent SDK turn failed: provider stream ended",
    causeName: "Error",
    causeMessage:
      "socket closed under ~/Developer/leilei-os-main with sk-[redacted]",
    causeCode: "ECONNRESET",
    providerSessionId: "provider-debug",
    resultSubtype: "error_during_execution",
    resultIsError: true,
    resultErrorMessages: [
      "upstream disconnected",
      "Bearer [redacted]",
    ],
    eventCount: 4,
    normalizedEventCount: 2,
    lastRawEventTypes: [
      "system:init",
      "assistant",
      "user",
      "result:error_during_execution",
    ],
    lastNormalizedEventTypes: [
      "partial_text",
      "result",
    ],
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostics[0]),
    /PRIVATE PROMPT|PRIVATE MODEL TEXT|PRIVATE FINAL TEXT|PRIVATE STDERR|Admin1|secretsecret/,
  );
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


test("interactive foreground runtime is preferred and receives streaming branch identity", async () => {
  const calls: unknown[] = [];
  const runtime = {
    async sendNew() {
      throw new Error("phase-1 sendNew must not be used");
    },
    async resume() {
      throw new Error("phase-1 resume must not be used");
    },
    async fork() {
      throw new Error("phase-1 fork must not be used");
    },
    async executeTurn(
      prompt: string,
      options: {
        mode: "new" | "fork";
        parentProviderSessionId: string | null;
        streaming: boolean;
      },
    ) {
      calls.push([prompt, options]);
      return {
        providerSessionId: "provider-interactive-child",
        normalizedEvents: [
          {
            type: "partial_text",
            payload: {
              delta: "hel",
              accumulated_length: 3,
            },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: "hello",
            },
          },
        ],
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      operation: "retry",
      runtime_mode: "fork",
      parent_provider_session_id: "provider-parent",
    }),
  );

  assert.deepEqual(calls, [[
    "hello",
    {
      mode: "fork",
      parentProviderSessionId: "provider-parent",
      streaming: true,
      userMessageUuid: userMessageId,
    },
  ]]);
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(
    result.provider_session_id,
    "provider-interactive-child",
  );
  assert.deepEqual(
    result.normalized_events.map((event) => event.type),
    ["result"],
  );
});


test("foreground MCP resource links become durable output-resource candidates without making task events canonical", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-resources",
        normalizedEvents: [
          {
            type: "tool_result",
            payload: {
              tool_use_id: "tool-foreground",
              output: "generated",
              is_error: false,
              resource_links: [{
                type: "resource_link",
                uri: "mcp://exports/report.pdf",
                name: "report.pdf",
                title: "Report",
                description: "Generated report",
                mime_type: "application/pdf",
                size: 12345,
                annotations: { audience: ["user"] },
                metadata: { source: "mcp" },
              }],
            },
          },
          {
            type: "task",
            payload: {
              phase: "notification",
              task_id: "task-background",
              tool_use_id: "tool-background",
              resource_links: [{
                type: "resource_link",
                uri: "mcp://exports/chart.svg",
                name: "chart.svg",
                title: null,
                description: null,
                mime_type: "image/svg+xml",
                size: 4096,
                annotations: null,
                metadata: null,
              }],
            },
          },
        ],
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(
    result.normalized_events.map((event) => event.type),
    ["tool_result"],
  );
  assert.deepEqual(
    result.runtime_metadata?.output_resources,
    [
      {
        source: "tool_result",
        tool_use_id: "tool-foreground",
        task_id: null,
        uri: "mcp://exports/report.pdf",
        name: "report.pdf",
        title: "Report",
        description: "Generated report",
        mime_type: "application/pdf",
        size: 12345,
        annotations: { audience: ["user"] },
        metadata: { source: "mcp" },
      },
      {
        source: "task_notification",
        tool_use_id: "tool-background",
        task_id: "task-background",
        uri: "mcp://exports/chart.svg",
        name: "chart.svg",
        title: null,
        description: null,
        mime_type: "image/svg+xml",
        size: 4096,
        annotations: null,
        metadata: null,
      },
    ],
  );
  assert.equal(result.output_attachment_ids, undefined);
});

test("provider-terminal failure retains MCP output-resource candidates", async () => {
  const runtime: NativeLiveClaudeRuntime = {
    async sendNew() {
      throw Object.assign(
        new Error("provider failed after producing a resource"),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          normalizedEvents: [{
            type: "tool_result",
            payload: {
              tool_use_id: "tool-before-failure",
              output: "generated",
              is_error: false,
              resource_links: [{
                type: "resource_link",
                uri: "mcp://exports/recovery.txt",
                name: "recovery.txt",
                title: null,
                description: null,
                mime_type: "text/plain",
                size: 128,
                annotations: null,
                metadata: null,
              }],
            },
          }],
        },
      );
    },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "failure");
  if (result.status !== "failure") {
    throw new Error("expected failure");
  }
  assert.deepEqual(
    result.runtime_metadata?.output_resources,
    [{
      source: "tool_result",
      tool_use_id: "tool-before-failure",
      task_id: null,
      uri: "mcp://exports/recovery.txt",
      name: "recovery.txt",
      title: null,
      description: null,
      mime_type: "text/plain",
      size: 128,
      annotations: null,
      metadata: null,
    }],
  );
});

test("interactive foreground runtime receives the exact prepared execution selection", async () => {
  let received: unknown = null;
  const runtime = {
    async sendNew() {
      throw new Error("phase-1 sendNew must not be used");
    },
    async resume() {
      throw new Error("phase-1 resume must not be used");
    },
    async fork() {
      throw new Error("phase-1 fork must not be used");
    },
    async executeTurn(
      _prompt: string,
      options: Record<string, unknown>,
    ) {
      received = options;
      return {
        providerSessionId: "provider-selected",
        normalizedEvents: [],
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      execution_selection: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "medium",
      },
    }),
  );

  assert.equal(result.status, "success");
  assert.deepEqual(received, {
    mode: "new",
    parentProviderSessionId: null,
    streaming: true,
    userMessageUuid: userMessageId,
    execution: {
      model: "claude-opus-5-5",
      thinking: "adaptive",
      effort: "medium",
    },
  });
});


test("foreground context usage never triggers compact automatically", async () => {
  let compactCalls = 0;
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-manual-only",
        normalizedEvents: [],
        contextUsage: {
          model: "claude-opus-5-5",
          total_tokens: 990000,
          max_tokens: 1000000,
          raw_max_tokens: 1000000,
          percentage: 99,
          categories: [],
        },
      };
    },
    async compact() {
      compactCalls += 1;
      throw new Error("foreground execution must never compact automatically");
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command(),
  );

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(compactCalls, 0);
  assert.equal(result.runtime_metadata?.context_usage?.percentage, 99);
});

test("foreground execution readback is persisted as bounded runtime metadata", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-readback",
        normalizedEvents: [],
        contextUsage: null,
        executionReadback: {
          requested: {
            model: "claude-opus-5-5",
            thinking: "adaptive",
            effort: "high",
          },
          applied: {
            model: "claude-opus-5-5",
            effort: "high",
          },
          capability: {
            value: "claude-opus-5-5",
            display_name: "Claude Opus 5.5",
            description: "test model",
            supports_effort: true,
            supported_effort_levels: [
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
            ],
            supports_adaptive_thinking: true,
            supports_fast_mode: false,
            supports_auto_mode: false,
          },
          supported_models: [{
            value: "claude-opus-5-5",
          }],
        },
        executionReadbackError: null,
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      execution_selection: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      },
    }),
  );

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata?.execution, {
    readback: {
      requested: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      },
      applied: {
        model: "claude-opus-5-5",
        effort: "high",
      },
      capability: {
        value: "claude-opus-5-5",
        display_name: "Claude Opus 5.5",
        description: "test model",
        supports_effort: true,
        supported_effort_levels: [
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        supports_adaptive_thinking: true,
        supports_fast_mode: false,
        supports_auto_mode: false,
      },
    },
    readback_error: null,
  });
  assert.equal(
    "supported_models" in (
      result.runtime_metadata?.execution?.readback
      ?? {}
    ),
    false,
  );
});

test("foreground execution readback errors are persisted as bounded codes only", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-readback-error",
        normalizedEvents: [],
        contextUsage: null,
        executionReadback: {
          requested: {
            model: "claude-opus-5-5",
            thinking: "adaptive",
            effort: "medium",
          },
          applied: {
            model: null,
            effort: null,
          },
          capability: null,
          supported_models: [],
        },
        executionReadbackError:
          "private /Users/Admin1/sdk settings failure",
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(runtime).execute(
    command({
      execution_selection: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "medium",
      },
    }),
  );

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(
    result.runtime_metadata?.execution?.readback_error,
    "READBACK_UNAVAILABLE",
  );
  assert.doesNotMatch(
    JSON.stringify(result.runtime_metadata),
    /Admin1|sdk settings failure/,
  );
});


test("protocol v3 collects explicit send_file output attachment ids", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const sent: unknown[] = [];
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: (input: {
          path: string;
          displayName: string | null;
        }) => Promise<{
          attachmentId: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          sha256: string;
          kind: "image" | "file";
        }>;
      },
    ) {
      assert.equal(typeof options.sendFileHandler, "function");
      const attachment = await options.sendFileHandler!({
        path: "out/report.pdf",
        displayName: "report.pdf",
      });
      assert.equal(attachment.attachmentId, attachmentId);
      return {
        providerSessionId: "provider-output",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile(input: {
      path: string;
      displayName?: string | null;
      workspaceRoot: string;
    }) {
      sent.push(input);
      return {
        attachmentId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file" as const,
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      sender,
    ).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(sent, [{
    path: "out/report.pdf",
    displayName: "report.pdf",
    workspaceRoot: "/workspace",
  }]);
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
});

test("protocol v3 album save is bound to canonical user identity and emits album_saved", async () => {
  const observed: unknown[] = [];
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          savePhoto(input: {
            sourceAttachmentId: string;
            description: string | null;
            whySaved: string;
            tags: string[];
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            created: boolean;
          }>;
        };
      },
    ) {
      await options.albumHandlers!.savePhoto({
        sourceAttachmentId:
          "99999999-9999-4999-8999-999999999999",
        description: null,
        whySaved: "keep",
        tags: [],
      });
      return {
        providerSessionId: "provider-album-save",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto(input: {
      sourceAttachmentId: string;
      triggerUserMessageId: string;
      description: string | null;
      whySaved: string;
      tags: string[];
    }) {
      observed.push(input);
      return {
        created: true,
        photo: {
          id: "88888888-8888-4888-8888-888888888888",
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: null,
          whySaved: input.whySaved,
          tags: [],
          sourceAttachmentId: input.sourceAttachmentId,
          sourceMessageId: null,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
    async searchPhotos() {
      return [];
    },
    async viewPhoto() {
      throw new Error("unused");
    },
    async sendPhoto() {
      throw new Error("unused");
    },
  };
  const events: unknown[] = [];
  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 3 }),
      {
        onNormalizedEvent: async (event) => {
          events.push(event);
        },
      },
    );

  assert.equal(result.status, "success");
  const expectedUserMessageId =
    command({ protocol_version: 3 })
      .canonical_user_message_id;
  assert.deepEqual(observed, [{
    sourceAttachmentId:
      "99999999-9999-4999-8999-999999999999",
    triggerUserMessageId: expectedUserMessageId,
    description: null,
    whySaved: "keep",
    tags: [],
  }]);
  assert.deepEqual(events, [{
    type: "runtime",
    payload: {
      kind: "album_saved",
      photo_id:
        "88888888-8888-4888-8888-888888888888",
      filename: "favorite.webp",
      source_attachment_id:
        "99999999-9999-4999-8999-999999999999",
      user_message_uuid: expectedUserMessageId,
    },
  }]);
});

test("protocol v3 album save retry does not emit a duplicate album_saved event", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          savePhoto(input: {
            sourceAttachmentId: string;
            description: string | null;
            whySaved: string;
            tags: string[];
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            created: boolean;
          }>;
        };
      },
    ) {
      await options.albumHandlers!.savePhoto({
        sourceAttachmentId:
          "99999999-9999-4999-8999-999999999999",
        description: null,
        whySaved: "keep",
        tags: [],
      });
      return {
        providerSessionId: "provider-album-retry",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto(input: {
      sourceAttachmentId: string;
      triggerUserMessageId: string;
      description: string | null;
      whySaved: string;
      tags: string[];
    }) {
      return {
        created: false,
        photo: {
          id: "88888888-8888-4888-8888-888888888888",
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: null,
          whySaved: input.whySaved,
          tags: [],
          sourceAttachmentId: input.sourceAttachmentId,
          sourceMessageId: input.triggerUserMessageId,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
      };
    },
    async searchPhotos() {
      return [];
    },
    async viewPhoto() {
      throw new Error("unused");
    },
    async sendPhoto() {
      throw new Error("unused");
    },
  };
  const events: unknown[] = [];

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 3 }),
      {
        onNormalizedEvent: async (event) => {
          events.push(event);
        },
      },
    );

  assert.equal(result.status, "success");
  assert.deepEqual(events, []);
});

test("protocol v3 album send contributes to output attachment ids", async () => {
  const attachmentId =
    "77777777-7777-4777-8777-777777777777";
  const photoId =
    "88888888-8888-4888-8888-888888888888";
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        albumHandlers?: {
          sendPhoto(input: {
            photoId: string;
          }): Promise<{
            photo: {
              id: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              description: string | null;
              whySaved: string;
              tags: string[];
              sourceAttachmentId: string;
              sourceMessageId: string | null;
              createdAt: string;
            };
            attachment: {
              attachmentId: string;
              filename: string;
              mimeType: string;
              sizeBytes: number;
              sha256: string;
              kind: "image";
            };
          }>;
        };
      },
    ) {
      assert.equal(
        typeof options.albumHandlers?.sendPhoto,
        "function",
      );
      const result =
        await options.albumHandlers!.sendPhoto({
          photoId,
        });
      assert.equal(
        result.attachment.attachmentId,
        attachmentId,
      );
      return {
        providerSessionId: "provider-album",
        normalizedEvents: [],
      };
    },
  };
  const albumClient = {
    async savePhoto() {
      throw new Error("unused");
    },
    async searchPhotos() {
      return [];
    },
    async sendPhoto(input: { photoId: string }) {
      assert.equal(input.photoId, photoId);
      return {
        photo: {
          id: photoId,
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          description: "window light",
          whySaved: "keep",
          tags: [],
          sourceAttachmentId:
            "99999999-9999-4999-8999-999999999999",
          sourceMessageId: null,
          createdAt: "2026-10-02T04:00:00.000Z",
        },
        attachment: {
          attachmentId,
          filename: "favorite.webp",
          mimeType: "image/webp",
          sizeBytes: 42,
          sha256: "a".repeat(64),
          kind: "image" as const,
        },
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      null,
      null,
      albumClient,
    ).execute(
      command({ protocol_version: 3 }),
    );

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.deepEqual(
    result.output_attachment_ids,
    [attachmentId],
  );
});

test("legacy runtime turns do not expose send_file", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn(
      _prompt: string,
      options: {
        sendFileHandler?: unknown;
      },
    ) {
      assert.equal(options.sendFileHandler, undefined);
      return {
        providerSessionId: "provider-legacy",
        normalizedEvents: [],
      };
    },
  };
  const sender = {
    async sendFile() {
      throw new Error("legacy turn must not send files");
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(
      runtime,
      "/workspace",
      null,
      sender,
    ).execute(command({ protocol_version: 2 }));

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error("expected success");
  }
  assert.equal(result.output_attachment_ids, undefined);
});


test("zero-event LeileiOS MCP startup failure retries the same foreground turn once", async () => {
  let calls = 0;
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(
          new Error(
            "LeileiOS MCP did not connect before the Claude turn started.",
          ),
          {
            runtimeCode: "RUNTIME_UNAVAILABLE",
            events: [],
            normalizedEvents: [],
          },
        );
      }
      return {
        providerSessionId: "provider-after-mcp-retry",
        normalizedEvents: [],
      };
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.equal(calls, 2);
  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.equal(result.provider_session_id, "provider-after-mcp-retry");
});

test("MCP startup retry is never used after any runtime event was observed", async () => {
  let calls = 0;
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      calls += 1;
      throw Object.assign(
        new Error(
          "LeileiOS MCP did not connect before the Claude turn started.",
        ),
        {
          runtimeCode: "RUNTIME_UNAVAILABLE",
          events: [{ type: "system", subtype: "init" }],
          normalizedEvents: [],
        },
      );
    },
  };

  const result =
    await new NativeLiveMacRuntimeExecutor(runtime).execute(command());

  assert.equal(calls, 1);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "RUNTIME_UNAVAILABLE");
});



test("SessionStore health is persisted as durable runtime metadata", async () => {
  const sessionStore = {
    provider: "claude_agent_sdk" as const,
    configured: true,
    mode: "new" as const,
    session_id: "provider-session-store",
    parent_session_id: null,
    project_key: "/workspace",
    cwd: "/workspace",
    parent_local_available: null,
    parent_status_before: null,
    backfill_status: "not_needed" as const,
    backfill_failure_reason: null,
    mirror_status: "ok" as const,
    mirror_failure_reason: null,
    status_after: "complete" as const,
    status_failure_reason: null,
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-session-store",
        normalizedEvents: [],
        sessionStoreObservability: sessionStore,
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    session_store: sessionStore,
  });
});

test("provider terminal failure retains SessionStore mirror health", async () => {
  const sessionStore = {
    provider: "claude_agent_sdk" as const,
    configured: true,
    mode: "new" as const,
    session_id: "provider-failed-store",
    parent_session_id: null,
    project_key: "/workspace",
    cwd: "/workspace",
    parent_local_available: null,
    parent_status_before: null,
    backfill_status: "not_needed" as const,
    backfill_failure_reason: null,
    mirror_status: "error" as const,
    mirror_failure_reason: "remote append failed",
    status_after: "incomplete" as const,
    status_failure_reason: null,
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      throw Object.assign(
        new Error("provider failed"),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          normalizedEvents: [],
          sessionStoreObservability: sessionStore,
        },
      );
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "CLAUDE_PROCESS_FAILED");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    session_store: sessionStore,
  });
});

test("system/init environment is persisted with terminal runtime metadata", async () => {
  const environment = {
    model: "claude-sonnet-5-5",
    cwd: "/workspace",
    tools: ["Read", "Bash"],
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
    plugins: [],
    plugin_errors: [],
    effort: "high",
    capabilities: ["interrupt_receipt_v1"],
    fast_mode: { state: "off", disabled_reason: null },
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-init",
        normalizedEvents: [{
          type: "session",
          payload: {
            provider_session_id: "provider-init",
            parent_provider_session_id: null,
            mode: "new",
            environment,
          },
        }],
        contextUsage: null,
        executionReadback: null,
        executionReadbackError: null,
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    environment,
  });
});
