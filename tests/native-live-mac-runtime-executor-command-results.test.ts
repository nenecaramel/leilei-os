import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import type {
  NativeLiveClaudeRuntime,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import {
  prepareId,
  requestId,
  conversationId,
  resultTelemetry,
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

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
    protocol_version: 4,
    prepare_id: prepareId,
    request_id: requestId,
    conversation_id: conversationId,
    status: "success",
    provider_session_id: "provider-new",
    effective_working_directory: "/",
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
      command({ protocol_version: 4 }),
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
      command({ protocol_version: 4 }),
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
    protocol_version: 4,
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
    protocol_version: 4,
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
    protocol_version: 4,
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
