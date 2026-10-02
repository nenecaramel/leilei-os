import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import type {
  NativeLiveClaudeRuntime,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";
import {
  userMessageId,
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

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
