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
    ["partial_text", "result"],
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
