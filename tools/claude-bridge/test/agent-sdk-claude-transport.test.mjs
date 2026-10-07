import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";
import { LEILEIOS_MIND_SYSTEM_PROMPT } from "../src/leileios-mind-system-prompt.mjs";
import { LEILEIOS_WAKE_SYSTEM_PROMPT } from "../src/leileios-wake-system-prompt.mjs";
import { LEILEIOS_MURMUR_SYSTEM_PROMPT } from "../src/leileios-murmur-system-prompt.mjs";

const LEILEIOS_INTERACTIVE_SYSTEM_PROMPT = [
  LEILEIOS_MIND_SYSTEM_PROMPT,
  LEILEIOS_WAKE_SYSTEM_PROMPT,
  LEILEIOS_MURMUR_SYSTEM_PROMPT,
].join("\n\n");

function fakeQuery(messages, { error = null } = {}) {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    close() {
      closed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
      if (error) throw error;
    },
  };
}

function fakeConnectedMcpQuery(messages) {
  return {
    ...fakeQuery(messages),
    async mcpServerStatus() {
      return [{
        name: "leileios",
        status: "connected",
      }];
    },
    async reconnectMcpServer() {},
  };
}

function successFixture(sessionId = "provider-sdk-1") {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
    },
    {
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [{ type: "text", text: "READY" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: "READY",
    },
  ];
}

test("sendNew preserves Claude Code settings and normalized event parity", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: { HOME: "/Users/leilei" },
    cwd: "/workspace/leilei-os",
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture());
    },
  });

  const emitted = [];
  transport.events.on("normalized-event", (event) => {
    emitted.push(event);
  });

  const result = await transport.sendNew("remember this");

  assert.deepEqual(call, {
    prompt: "remember this",
    options: {
      cwd: "/workspace/leilei-os",
      env: {
        HOME: "/Users/leilei",
        LEILEI_MIND_HOOK_DISABLED: "1",
        DISABLE_AUTO_COMPACT: "1",
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
      },
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      verbatimPrompts: true,
    },
  });
  assert.equal(result.providerSessionId, "provider-sdk-1");
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "text", "result"],
  );
  assert.deepEqual(result.normalizedEvents, emitted);
});

test("explicit model/thinking/effort selection reaches query options and returns applied readback", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async getSettings() {
          return {
            applied: {
              model: "claude-opus-5-5",
              effort: "medium",
            },
          };
        },
        async supportedModels() {
          return [
            {
              value: "claude-opus-5-5",
              displayName: "Claude Opus 5.5",
              description: "test",
              supportsEffort: true,
              supportedEffortLevels: [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              supportsAdaptiveThinking: true,
            },
          ];
        },
        async *[Symbol.asyncIterator]() {
          for (const message of successFixture("provider-model")) {
            yield message;
          }
        },
      };
    },
  });

  const result = await transport.sendNew("hello", {
    model: "claude-opus-5-5",
    thinking: "adaptive",
    effort: "medium",
  });

  assert.equal(call.options.model, "claude-opus-5-5");
  assert.deepEqual(call.options.thinking, { type: "adaptive" });
  assert.equal(call.options.effort, "medium");
  assert.equal(result.executionReadbackError, null);
  assert.deepEqual(result.executionReadback.applied, {
    model: "claude-opus-5-5",
    effort: "medium",
  });
  assert.equal(
    result.executionReadback.capability.supports_adaptive_thinking,
    true,
  );
});

test("resume passes provider session identity without forking", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-root"));
    },
  });

  const result = await transport.resume(
    "provider-root",
    "what was it?",
  );

  assert.equal(call.options.resume, "provider-root");
  assert.equal("forkSession" in call.options, false);
  assert.equal(result.providerSessionId, "provider-root");
});

test("fork uses resume plus forkSession and requires a new provider session id", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-fork"));
    },
  });

  const result = await transport.fork(
    "provider-root",
    "branch prompt",
  );

  assert.equal(call.options.resume, "provider-root");
  assert.equal(call.options.forkSession, true);
  assert.equal(result.providerSessionId, "provider-fork");

  const conflicting = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: () => fakeQuery(successFixture("provider-root")),
  });
  await assert.rejects(
    () => conflicting.fork("provider-root", "branch prompt"),
    (error) =>
      error.runtimeCode === "PROVIDER_SESSION_CONFLICT"
      && /same provider session id/i.test(error.message),
  );
});

test("resume and fork reject an absent local parent transcript before query", async () => {
  let queryCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async (sessionId, options) => {
      assert.equal(sessionId, "missing-parent");
      assert.deepEqual(options, {
        dir: "/workspace/leilei-os",
        limit: 1,
      });
      return [];
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  for (const run of [
    () => transport.resume("missing-parent", "resume"),
    () => transport.fork("missing-parent", "fork"),
  ]) {
    await assert.rejects(
      run,
      (error) =>
        error.runtimeCode === "NO_PROVIDER_SESSION"
        && error.parentSessionId === "missing-parent"
        && /complete durable transcript/i.test(error.message),
    );
  }
  assert.equal(queryCalls, 0);
});

test("durable SessionStore resumes when the local transcript is absent", async () => {
  let call;
  const statusCalls = [];
  let state = "complete";
  const durableStore = {
    async append() {},
    async load(key) {
      assert.equal(key.sessionId, "provider-remote");
      return [{ type: "user", message: { role: "user", content: "hello" } }];
    },
    async getStatus(sessionId) {
      assert.equal(sessionId, "provider-remote");
      return state;
    },
    async markIncomplete(sessionId) {
      assert.equal(sessionId, "provider-remote");
      statusCalls.push("incomplete");
      state = "incomplete";
    },
    async markComplete(sessionId) {
      assert.equal(sessionId, "provider-remote");
      statusCalls.push("complete");
      state = "complete";
    },
    async delete() {},
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [],
    sessionStore: durableStore,
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-remote"));
    },
  });

  const result = await transport.resume(
    "provider-remote",
    "continue",
  );

  assert.equal(result.providerSessionId, "provider-remote");
  assert.equal(call.options.resume, "provider-remote");
  assert.equal(call.options.sessionStore, durableStore);
  assert.deepEqual(statusCalls, ["incomplete", "complete"]);
  assert.equal(state, "complete");
});

test("durable SessionStore failures remain fail-closed", async () => {
  const cause = new Error("remote transcript unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: {
      async append() {},
      async getStatus() { return "complete"; },
      async load() {
        throw cause;
      },
    },
    queryImpl: () => fakeQuery(successFixture("unexpected")),
  });

  await assert.rejects(
    () => transport.resume("provider-remote", "continue"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /durable Claude Agent SDK parent session/i.test(error.message),
  );
});

test("remote-only resume rejects incomplete transcript before query", async () => {
  let queryCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: {
      async append() {},
      async getStatus() { return "incomplete"; },
      async load() {
        throw new Error("incomplete transcript must not be loaded");
      },
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  await assert.rejects(
    () => transport.resume("provider-incomplete", "continue"),
    (error) =>
      error.runtimeCode === "NO_PROVIDER_SESSION"
      && /complete durable transcript/i.test(error.message),
  );
  assert.equal(queryCalls, 0);
});

test("complete local resume fails before query if completeness cannot be invalidated", async () => {
  let queryCalls = 0;
  const cause = new Error("status write unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: {
      async append() {},
      async getStatus() { return "complete"; },
      async markIncomplete() { throw cause; },
      async load() { return [{ type: "assistant" }]; },
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  await assert.rejects(
    () => transport.resume("provider-root", "continue"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /mark durable Claude Agent SDK session incomplete/i.test(error.message),
  );
  assert.equal(queryCalls, 0);
});

test("mirror_error leaves a previously complete session incomplete", async () => {
  let state = "complete";
  const statusCalls = [];
  const discarded = [];
  const durableStore = {
    async append() {},
    async getStatus() { return state; },
    discardPendingAppends(sessionId) {
      discarded.push(sessionId);
    },
    async markIncomplete() {
      state = "incomplete";
      statusCalls.push("incomplete");
    },
    async markComplete() {
      state = "complete";
      statusCalls.push("complete");
    },
    async load() { return [{ type: "assistant" }]; },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: durableStore,
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-root",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-root",
        error: "remote append failed",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-root",
        result: "READY",
      },
    ]),
  });

  const result = await transport.resume("provider-root", "continue");
  assert.equal(result.providerSessionId, "provider-root");
  assert.deepEqual(statusCalls, ["incomplete"]);
  assert.deepEqual(discarded, ["provider-root"]);
  assert.equal(state, "incomplete");
  assert.deepEqual(result.sessionStoreObservability, {
    provider: "claude_agent_sdk",
    configured: true,
    mode: "resume",
    session_id: "provider-root",
    parent_session_id: "provider-root",
    project_key: process.cwd(),
    cwd: process.cwd(),
    parent_local_available: true,
    parent_status_before: "complete",
    backfill_status: "not_needed",
    backfill_failure_reason: null,
    mirror_status: "error",
    mirror_failure_reason: "remote append failed",
    status_after: "incomplete",
    status_failure_reason: null,
  });
});

test("legacy local session is backfilled before it becomes portable", async () => {
  let imported = false;
  let state = null;
  const statusCalls = [];
  let importArgs;
  const durableStore = {
    async append() {},
    async getStatus() { return state; },
    async load() {
      return imported ? [{ type: "assistant", old: true }] : null;
    },
    async markIncomplete() {
      state = "incomplete";
      statusCalls.push("incomplete");
    },
    async markComplete() {
      state = "complete";
      statusCalls.push("complete");
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: durableStore,
    importSessionToStoreImpl: async (sessionId, store, options) => {
      importArgs = { sessionId, store, options };
      imported = true;
    },
    queryImpl: () => fakeQuery(successFixture("legacy-local")),
  });

  await transport.resume("legacy-local", "continue");

  assert.deepEqual(importArgs, {
    sessionId: "legacy-local",
    store: durableStore,
    options: {
      dir: "/workspace/leilei-os",
      includeSubagents: true,
      batchSize: 500,
    },
  });
  assert.deepEqual(
    statusCalls,
    ["complete", "incomplete", "complete"],
  );
  assert.equal(state, "complete");
});

test("legacy local session keeps working if durable backfill fails", async () => {
  let queryCalls = 0;
  let completeCalls = 0;
  const backfillError = new Error("remote store unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: {
      async append() {},
      async getStatus() { return null; },
      async load() { return null; },
      async markComplete() { completeCalls += 1; },
    },
    importSessionToStoreImpl: async () => {
      throw backfillError;
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("legacy-local"));
    },
  });

  const errors = [];
  transport.events.on("session-store-backfill-error", (error) => {
    errors.push(error);
  });

  const result = await transport.resume("legacy-local", "continue");

  assert.equal(result.providerSessionId, "legacy-local");
  assert.equal(queryCalls, 1);
  assert.equal(completeCalls, 0);
  assert.deepEqual(errors, [backfillError]);
  assert.deepEqual(result.sessionStoreObservability, {
    provider: "claude_agent_sdk",
    configured: true,
    mode: "resume",
    session_id: "legacy-local",
    parent_session_id: "legacy-local",
    project_key: process.cwd(),
    cwd: process.cwd(),
    parent_local_available: true,
    parent_status_before: null,
    backfill_status: "failed",
    backfill_failure_reason: "remote store unavailable",
    mirror_status: "ok",
    mirror_failure_reason: null,
    status_after: null,
    status_failure_reason: null,
  });
});

test("new session becomes portable only after a readable mirrored transcript exists", async () => {
  let completeCalls = 0;
  const durableStore = {
    async append() {},
    async load(key) {
      assert.equal(key.sessionId, "provider-new-portable");
      return [{ type: "user", text: "mirrored" }];
    },
    async markComplete(sessionId) {
      assert.equal(sessionId, "provider-new-portable");
      completeCalls += 1;
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionStore: durableStore,
    queryImpl: () => fakeQuery(successFixture("provider-new-portable")),
  });

  await transport.sendNew("hello");
  assert.equal(completeCalls, 1);
});

test("new session stays incomplete when mirror_error is emitted", async () => {
  let completeCalls = 0;
  let state = null;
  const durableStore = {
    async append() {},
    async getStatus() { return state; },
    async load() {
      throw new Error("must not probe a failed mirror");
    },
    async markIncomplete() {
      state = "incomplete";
    },
    async markComplete() {
      completeCalls += 1;
      state = "complete";
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionStore: durableStore,
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-new-incomplete",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-new-incomplete",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-new-incomplete",
        result: "READY",
      },
    ]),
  });

  const result = await transport.sendNew("hello");
  assert.equal(completeCalls, 0);
  assert.equal(state, "incomplete");
  assert.equal(
    result.sessionStoreObservability.mirror_status,
    "error",
  );
  assert.equal(
    result.sessionStoreObservability.status_after,
    "incomplete",
  );
});

test("mirror health stays fail-soft when the durable status store is unavailable", async () => {
  let markIncompleteCalls = 0;
  let getStatusCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionStore: {
      async append() {},
      async getStatus() {
        getStatusCalls += 1;
        throw new Error("status endpoint unavailable");
      },
      async markIncomplete() {
        markIncompleteCalls += 1;
        throw new Error("status endpoint unavailable");
      },
    },
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-store-outage",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-store-outage",
        error: "remote append failed",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-store-outage",
        result: "READY",
      },
    ]),
  });

  const result = await transport.sendNew("hello");

  assert.equal(result.providerSessionId, "provider-store-outage");
  assert.equal(markIncompleteCalls, 1);
  assert.equal(
    getStatusCalls,
    0,
    "mirror observability must not amplify a known SessionStore outage",
  );
  assert.equal(
    result.sessionStoreObservability.mirror_status,
    "error",
  );
  assert.equal(
    result.sessionStoreObservability.status_after,
    null,
  );
  assert.equal(
    result.sessionStoreObservability.status_failure_reason,
    "status endpoint unavailable",
  );
});

test("fork keeps a complete parent readable and marks only the mirrored child complete", async () => {
  const statusCalls = [];
  const durableStore = {
    async append() {},
    async getStatus(sessionId) {
      assert.equal(sessionId, "provider-parent");
      return "complete";
    },
    async load(key) {
      return [{ type: "assistant", session: key.sessionId }];
    },
    async markIncomplete(sessionId) {
      statusCalls.push(["incomplete", sessionId]);
    },
    async markComplete(sessionId) {
      statusCalls.push(["complete", sessionId]);
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: durableStore,
    queryImpl: () => fakeQuery(successFixture("provider-child")),
  });

  const result = await transport.fork("provider-parent", "branch");
  assert.equal(result.providerSessionId, "provider-child");
  assert.deepEqual(statusCalls, [["complete", "provider-child"]]);
});

test("Agent SDK deletion receives the durable SessionStore", async () => {
  let deletion;
  const durableStore = {
    async append() {},
    async load() { return null; },
    async delete() {},
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionStore: durableStore,
    deleteSessionImpl: async (sessionId, options) => {
      deletion = { sessionId, options };
    },
  });

  await transport.deleteSession("provider-delete");

  assert.deepEqual(deletion, {
    sessionId: "provider-delete",
    options: {
      dir: "/workspace/leilei-os",
      sessionStore: durableStore,
    },
  });
});

test("session preflight read failures stay RUNTIME_UNAVAILABLE", async () => {
  const cause = new Error("session store unreadable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => {
      throw cause;
    },
    queryImpl: () => fakeQuery(successFixture("unexpected")),
  });

  await assert.rejects(
    () => transport.fork("provider-root", "branch prompt"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /failed to inspect/i.test(error.message),
  );
});

test("normal turns expose the latest live context usage with provider auto-compact disabled", async () => {
  let usageCalls = 0;
  let queryInput;
  const transport = new AgentSdkClaudeTransport({
    environment: {
      DISABLE_AUTO_COMPACT: "0",
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "0",
    },
    queryImpl: (input) => {
      queryInput = input;
      return {
        close() {},
        async getContextUsage() {
        usageCalls += 1;
        const percentage =
          usageCalls === 1 ? 74 : usageCalls === 2 ? 75 : 76;
        return {
          model: "claude-opus-5-5",
          totalTokens: percentage * 10000,
          maxTokens: 1000000,
          rawMaxTokens: 1000000,
          percentage,
          categories: [
            {
              name: "Messages",
              tokens: percentage * 9000,
              kind: "used",
            },
          ],
        };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-context",
        };
        yield {
          type: "assistant",
          session_id: "provider-context",
          message: {
            content: [{ type: "text", text: "working" }],
          },
        };
        yield {
          type: "assistant",
          session_id: "provider-context",
          message: {
            content: [{ type: "text", text: "READY" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-context",
          result: "READY",
        };
      },
      };
    },
  });

  const result = await transport.sendNew("hello");
  assert.equal(usageCalls, 3);

  assert.deepEqual(result.contextUsage, {
    model: "claude-opus-5-5",
    total_tokens: 760000,
    max_tokens: 1000000,
    raw_max_tokens: 1000000,
    percentage: 76,
    categories: [
      {
        name: "Messages",
        tokens: 684000,
        kind: "used",
        is_deferred: null,
      },
    ],
  });
  assert.equal(result.contextUsageError, null);
  assert.equal(
    queryInput.options.env.DISABLE_AUTO_COMPACT,
    "1",
  );
  assert.equal(
    queryInput.options.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS,
    "1",
  );
});

test("compact uses a dedicated non-verbatim control path and returns lifecycle observability", async () => {
  let call;
  let compactUsageCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async getContextUsage() {
          compactUsageCalls += 1;
          if (compactUsageCalls > 1) {
            throw new Error("query already finished");
          }
          return {
            model: "claude-opus-5-5",
            totalTokens: 1302,
            maxTokens: 1000000,
            rawMaxTokens: 1000000,
            percentage: 0.1302,
            categories: [],
          };
        },
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-root",
          };

          await input.options.hooks.PreCompact[0].hooks[0]({
            hook_event_name: "PreCompact",
            trigger: "manual",
            custom_instructions: null,
          });

          yield {
            type: "system",
            subtype: "compact_boundary",
            session_id: "provider-root",
            compact_metadata: {
              trigger: "manual",
              pre_tokens: 28485,
              post_tokens: 1302,
              duration_ms: 10123,
              preserved_segment: {
                head_uuid: "head",
                anchor_uuid: "anchor",
                tail_uuid: "tail",
              },
            },
          };

          await input.options.hooks.PostCompact[0].hooks[0]({
            hook_event_name: "PostCompact",
            trigger: "manual",
            compact_summary: "summary with durable marker",
          });

          yield {
            type: "result",
            subtype: "success",
            session_id: "provider-root",
            result: "",
          };
        },
      };
    },
  });

  const result = await transport.compact("provider-root");

  assert.equal(compactUsageCalls, 2);
  assert.equal(call.prompt, "/compact");
  assert.equal(call.options.resume, "provider-root");
  assert.equal(call.options.verbatimPrompts, false);
  assert.ok(call.options.hooks);
  assert.equal(result.providerSessionId, "provider-root");
  assert.deepEqual(result.contextUsage, {
    model: "claude-opus-5-5",
    total_tokens: 1302,
    max_tokens: 1000000,
    raw_max_tokens: 1000000,
    percentage: 0.1302,
    categories: [],
  });
  assert.deepEqual(result.compaction.boundary, {
    trigger: "manual",
    pre_tokens: 28485,
    post_tokens: 1302,
    duration_ms: 10123,
    preserved_segment: {
      head_uuid: "head",
      anchor_uuid: "anchor",
      tail_uuid: "tail",
    },
  });
  assert.deepEqual(result.compaction.preCompact, [
    {
      hookEventName: "PreCompact",
      trigger: "manual",
      customInstructions: null,
    },
  ]);
  assert.deepEqual(result.compaction.postCompact, [
    {
      hookEventName: "PostCompact",
      trigger: "manual",
      summary: "summary with durable marker",
    },
  ]);
});

test("compact refuses to claim success if the SDK emits no compact boundary", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-root",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-root",
        result: "",
      },
    ]),
  });

  await assert.rejects(
    () => transport.compact("provider-root"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /without a compact boundary/i.test(error.message),
  );
});

test("SDK terminal error results map into existing runtime failure semantics", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-sdk-failure",
      },
      {
        type: "result",
        subtype: "error_during_execution",
        session_id: "provider-sdk-failure",
        errors: ["permission denied"],
      },
    ]),
  });

  await assert.rejects(
    () => transport.sendNew("hello"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /permission denied/i.test(error.message),
  );
});

test("query transport exceptions map into existing process failure semantics", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () =>
      fakeQuery([], { error: new Error("sdk subprocess died") }),
  });

  await assert.rejects(
    () => transport.sendNew("hello"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /sdk subprocess died/i.test(error.message),
  );
});

test("abort closes the active SDK query and reports ABORTED", async () => {
  let release;
  let active;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => {
      let closed = false;
      active = {
        close() {
          closed = true;
          release();
        },
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-abort",
          };
          await gate;
          if (!closed) {
            yield {
              type: "result",
              subtype: "success",
              session_id: "provider-abort",
              result: "should not finish",
            };
          }
        },
      };
      return active;
    },
  });

  const run = transport.sendNew("long task");
  await new Promise((resolve) => setImmediate(resolve));
  transport.abort();

  await assert.rejects(
    () => run,
    (error) => error.runtimeCode === "ABORTED",
  );
  assert.ok(active);
});

test("refuses API-key mode and keeps subscription-auth boundary", () => {
  assert.throws(
    () =>
      new AgentSdkClaudeTransport({
        environment: { ANTHROPIC_API_KEY: "forbidden" },
        queryImpl: () => fakeQuery([]),
      }),
    /ANTHROPIC_API_KEY/,
  );
});

test("SDK loading stays lazy so the old transport remains a valid rollback", async () => {
  let loadCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    loadQuery: async () => {
      loadCalls += 1;
      return () => fakeQuery(successFixture("lazy-provider"));
    },
  });

  assert.equal(loadCalls, 0);
  const result = await transport.sendNew("hello");
  assert.equal(loadCalls, 1);
  assert.equal(result.providerSessionId, "lazy-provider");
});


test("interactive foreground execution uses the dedicated turn handle with verbatim streaming", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-interactive-child",
          };
          yield {
            type: "stream_event",
            session_id: "provider-interactive-child",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "hel",
              },
            },
          };
          yield {
            type: "result",
            subtype: "success",
            session_id: "provider-interactive-child",
            result: "hello",
          };
        },
      };
    },
  });

  const emitted = [];
  const delivered = [];
  transport.events.on("normalized-event", (event) => {
    emitted.push(event.type);
  });

  const result = await transport.executeTurn(
    "branch prompt",
    {
      mode: "fork",
      parentProviderSessionId: "provider-parent",
      streaming: true,
      onNormalizedEvent: async (event) => {
        delivered.push(event.type);
      },
    },
  );

  assert.equal(
    typeof call.prompt?.[Symbol.asyncIterator],
    "function",
  );
  assert.equal(call.options.resume, "provider-parent");
  assert.equal(call.options.forkSession, true);
  assert.equal(call.options.verbatimPrompts, true);
  assert.deepEqual(call.options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    append: LEILEIOS_INTERACTIVE_SYSTEM_PROMPT,
  });
  assert.equal(call.options.includePartialMessages, true);
  assert.equal(
    result.providerSessionId,
    "provider-interactive-child",
  );
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "partial_text", "result"],
  );
  assert.deepEqual(
    emitted,
    ["session", "partial_text", "result"],
  );
  assert.deepEqual(
    delivered,
    ["session", "partial_text", "result"],
  );
});


test("local historical checkpoint fork materializes only the canonical prefix", async () => {
  const root = {
    type: "user",
    uuid: "11111111-1111-4111-8111-111111111111",
    parentUuid: null,
    message: { role: "user", content: "root" },
  };
  const checkpoint = {
    type: "assistant",
    uuid: "22222222-2222-4222-8222-222222222222",
    parentUuid: root.uuid,
    message: { role: "assistant", content: "checkpoint" },
  };
  const compact = {
    type: "system",
    uuid: "33333333-3333-4333-8333-333333333333",
    parentUuid: checkpoint.uuid,
    subtype: "compact_boundary",
  };
  const later = {
    type: "assistant",
    uuid: "44444444-4444-4444-8444-444444444444",
    parentUuid: compact.uuid,
    message: { role: "assistant", content: "later" },
  };
  const childCheckpoint = {
    type: "assistant",
    uuid: "55555555-5555-4555-8555-555555555555",
    parentUuid: checkpoint.uuid,
    message: { role: "assistant", content: "forked" },
  };

  let call;
  let prepared = null;
  let cleanupCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    importSessionToStoreImpl: async (sessionId, store) => {
      const entries =
        sessionId === "provider-parent"
          ? [root, checkpoint, compact, later]
          : [root, checkpoint, childCheckpoint];
      await store.append({ subpath: undefined }, entries);
    },
    prepareLocalCheckpointForkImpl: async (input) => {
      prepared = input;
      return {
        sessionId: "synthetic-local-parent",
        async cleanup() {
          cleanupCalls += 1;
        },
      };
    },
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-child"));
    },
  });

  const result = await transport.executeTurn(
    "edit from old checkpoint",
    {
      mode: "fork",
      parentProviderSessionId: "provider-parent",
      parentProviderCheckpointId: checkpoint.uuid,
      requireProviderCheckpoint: true,
      streaming: true,
    },
  );

  assert.deepEqual(
    prepared.prefix
      .filter((entry) => typeof entry.uuid === "string")
      .map((entry) => entry.uuid),
    [root.uuid, checkpoint.uuid],
  );
  assert.equal(call.options.resume, "synthetic-local-parent");
  assert.equal(call.options.resumeSessionAt, checkpoint.uuid);
  assert.equal(call.options.forkSession, true);
  assert.equal("sessionStore" in call.options, false);
  assert.equal(result.providerSessionId, "provider-child");
  assert.equal(result.providerCheckpointId, childCheckpoint.uuid);
  assert.equal(cleanupCalls, 1);
});


test("default local historical fork locates the parent by session id and cleans the temporary source", async (t) => {
  const configDirectory =
    await mkdtemp(join(tmpdir(), "leileios-local-fork-"));
  t.after(() =>
    rm(configDirectory, { recursive: true, force: true })
  );
  const receiptDirectory = join(
    configDirectory,
    "fork-receipts",
  );
  const cwd = "/workspace/leilei.os_test";
  const projectDirectory = join(
    configDirectory,
    "projects",
    "sdk-private-encoding-current-project",
  );
  await mkdir(projectDirectory, { recursive: true });

  const root = {
    type: "user",
    uuid: "81111111-1111-4111-8111-111111111111",
    parentUuid: null,
    sessionId: "provider-parent",
    message: { role: "user", content: "root" },
  };
  const checkpoint = {
    type: "assistant",
    uuid: "82222222-2222-4222-8222-222222222222",
    parentUuid: root.uuid,
    sessionId: "provider-parent",
    message: { role: "assistant", content: "checkpoint" },
  };
  const later = {
    type: "assistant",
    uuid: "83333333-3333-4333-8333-333333333333",
    parentUuid: checkpoint.uuid,
    sessionId: "provider-parent",
    message: { role: "assistant", content: "later" },
  };
  const child = {
    type: "assistant",
    uuid: "84444444-4444-4444-8444-444444444444",
    parentUuid: checkpoint.uuid,
    sessionId: "provider-child",
    message: { role: "assistant", content: "child" },
  };
  await writeFile(
    join(projectDirectory, "provider-parent.jsonl"),
    JSON.stringify(root) + "\n",
    "utf8",
  );

  let syntheticSessionId = null;
  const transport = new AgentSdkClaudeTransport({
    environment: {
      CLAUDE_CONFIG_DIR: configDirectory,
      LEILEIOS_LOCAL_CHECKPOINT_FORK_RECEIPT_DIR:
        receiptDirectory,
    },
    cwd,
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    importSessionToStoreImpl: async (sessionId, store) => {
      await store.append(
        { subpath: undefined },
        sessionId === "provider-parent"
          ? [root, checkpoint, later]
          : [root, checkpoint, child],
      );
    },
    queryImpl: (input) => {
      syntheticSessionId = input.options.resume;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          const raw = await readFile(
            join(
              projectDirectory,
              syntheticSessionId + ".jsonl",
            ),
            "utf8",
          );
          const restored = raw
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          assert.deepEqual(
            restored.map((entry) => entry.uuid),
            [root.uuid, checkpoint.uuid],
          );
          assert.ok(
            restored.every(
              (entry) =>
                entry.sessionId === syntheticSessionId,
            ),
          );
          for (const message of successFixture("provider-child")) {
            yield message;
          }
        },
      };
    },
  });

  const result = await transport.executeTurn(
    "historical fork",
    {
      mode: "fork",
      parentProviderSessionId: "provider-parent",
      parentProviderCheckpointId: checkpoint.uuid,
      requireProviderCheckpoint: true,
      streaming: true,
    },
  );

  assert.notEqual(syntheticSessionId, "provider-parent");
  assert.equal(result.providerCheckpointId, child.uuid);
  assert.deepEqual(
    (await readdir(projectDirectory)).sort(),
    ["provider-parent.jsonl"],
  );
  assert.deepEqual(
    await readdir(receiptDirectory),
    [],
  );
});

test("steady local resume reparses the transcript only after the turn", async () => {
  const root = {
    type: "user",
    uuid: "61111111-1111-4111-8111-111111111111",
    parentUuid: null,
    message: { role: "user", content: "root" },
  };
  const first = {
    type: "assistant",
    uuid: "62222222-2222-4222-8222-222222222222",
    parentUuid: root.uuid,
    message: { role: "assistant", content: "first" },
  };
  const second = {
    type: "assistant",
    uuid: "63333333-3333-4333-8333-333333333333",
    parentUuid: first.uuid,
    message: { role: "assistant", content: "second" },
  };
  const third = {
    type: "assistant",
    uuid: "64444444-4444-4444-8444-444444444444",
    parentUuid: second.uuid,
    message: { role: "assistant", content: "third" },
  };
  const snapshots = [
    [root, first],
    [root, first, second],
    [root, first, second, third],
  ];

  let importCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    importSessionToStoreImpl: async (_sessionId, store) => {
      const entries = snapshots[importCalls];
      importCalls += 1;
      assert.ok(entries, "unexpected extra local transcript parse");
      await store.append({ subpath: undefined }, entries);
    },
    queryImpl: () => fakeQuery(successFixture("provider-root")),
  });

  const firstResult = await transport.executeTurn(
    "continue",
    {
      mode: "resume",
      parentProviderSessionId: "provider-root",
      parentProviderCheckpointId: first.uuid,
      requireProviderCheckpoint: true,
      streaming: true,
    },
  );
  assert.equal(firstResult.providerCheckpointId, second.uuid);

  const secondResult = await transport.executeTurn(
    "continue again",
    {
      mode: "resume",
      parentProviderSessionId: "provider-root",
      parentProviderCheckpointId: second.uuid,
      requireProviderCheckpoint: true,
      streaming: true,
    },
  );
  assert.equal(secondResult.providerCheckpointId, third.uuid);
  assert.equal(importCalls, 3);
});

test("local checkpoint preflight rejects a broken ancestry before query", async () => {
  let queryCalls = 0;
  const checkpoint = {
    type: "assistant",
    uuid: "72222222-2222-4222-8222-222222222222",
    parentUuid: "missing-parent",
    message: { role: "assistant", content: "broken" },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    importSessionToStoreImpl: async (_sessionId, store) => {
      await store.append({ subpath: undefined }, [checkpoint]);
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("must-not-run"));
    },
  });

  await assert.rejects(
    () =>
      transport.executeTurn(
        "continue",
        {
          mode: "resume",
          parentProviderSessionId: "provider-root",
          parentProviderCheckpointId: checkpoint.uuid,
          requireProviderCheckpoint: true,
          streaming: true,
        },
      ),
    (error) =>
      error.runtimeCode === "NO_PROVIDER_SESSION"
      && /prefix is not durably present/i.test(error.message),
  );
  assert.equal(queryCalls, 0);
});

test("interactive native schedule commands use Claude slash-command parsing", async () => {
  for (const command of [
    "/schedule list",
    "/routines daily at 9am review open pull requests",
  ]) {
    let call;
    const transport = new AgentSdkClaudeTransport({
      environment: {},
      queryImpl: (input) => {
        call = input;
        return fakeQuery(successFixture("provider-schedule"));
      },
    });

    const result = await transport.executeTurn(
      command,
      {
        mode: "new",
        parentProviderSessionId: null,
        streaming: true,
        controlPump: async () => {},
      },
    );

    assert.equal(call.prompt, command);
    assert.equal(call.options.verbatimPrompts, false);
    assert.deepEqual(call.options.systemPrompt, {
      type: "preset",
      preset: "claude_code",
      append: LEILEIOS_INTERACTIVE_SYSTEM_PROMPT,
    });
    assert.equal(call.options.includePartialMessages, true);
    assert.equal(result.providerSessionId, "provider-schedule");
  }
});

test("ordinary interactive turns keep verbatim streaming input", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-ordinary"));
    },
  });

  await transport.executeTurn(
    "please schedule my notes conceptually",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      controlPump: async () => {},
    },
  );

  assert.equal(
    typeof call.prompt?.[Symbol.asyncIterator],
    "function",
  );
  assert.equal(call.options.verbatimPrompts, true);
  assert.deepEqual(call.options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    append: LEILEIOS_INTERACTIVE_SYSTEM_PROMPT,
  });
});

test("interactive provider failure retains SessionStore mirror health", async () => {
  let state = null;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionStore: {
      async append() {},
      async getStatus() { return state; },
      async markIncomplete() {
        state = "incomplete";
      },
    },
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-failed-mirror",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-failed-mirror",
        error: "remote append failed",
      },
      {
        type: "result",
        subtype: "error_during_execution",
        session_id: "provider-failed-mirror",
        errors: ["provider failed"],
      },
    ]),
  });

  await assert.rejects(
    () =>
      transport.executeTurn(
        "hello",
        {
          mode: "new",
          parentProviderSessionId: null,
          streaming: true,
        },
      ),
    (error) => {
      assert.equal(error.runtimeCode, "CLAUDE_PROCESS_FAILED");
      assert.deepEqual(error.sessionStoreObservability, {
        provider: "claude_agent_sdk",
        configured: true,
        mode: "new",
        session_id: "provider-failed-mirror",
        parent_session_id: null,
        project_key: "/workspace/leilei-os",
        cwd: "/workspace/leilei-os",
        parent_local_available: null,
        parent_status_before: null,
        backfill_status: "not_needed",
        backfill_failure_reason: null,
        mirror_status: "error",
        mirror_failure_reason: "remote append failed",
        status_after: "incomplete",
        status_failure_reason: null,
      });
      return true;
    },
  );
  assert.equal(state, "incomplete");
});

test("interactive foreground event delivery failure is observability-only", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        for (const message of successFixture("provider-event-fail-soft")) {
          yield message;
        }
      },
    }),
  });

  const failures = [];
  transport.events.on(
    "event-delivery-error",
    (error) => failures.push(error),
  );

  let attempts = 0;
  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      onNormalizedEvent: async () => {
        attempts += 1;
        throw new Error("event delivery unavailable");
      },
    },
  );

  assert.equal(
    result.providerSessionId,
    "provider-event-fail-soft",
  );
  assert.equal(attempts, 3);
  assert.equal(failures.length, 1);
});


test("interactive foreground execution binds permission and question host callbacks", async () => {
  const sdkDecisions = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: ({ options }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        sdkDecisions.push(
          await options.canUseTool(
            "Write",
            { file_path: "/tmp/a", content: "x" },
            {
              toolUseID: "tool-write-1",
              requestId: "request-write-1",
            },
          ),
        );
        sdkDecisions.push(
          await options.canUseTool(
            "AskUserQuestion",
            {
              questions: [{
                question: "Theme",
                options: [
                  { label: "Light" },
                  { label: "Dark" },
                ],
              }],
            },
            {
              toolUseID: "tool-question-1",
              requestId: "request-question-1",
            },
          ),
        );
        for (const message of successFixture("provider-interactions")) {
          yield message;
        }
      },
    }),
  });

  const requests = [];
  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      permissionHandler: async (request) => {
        requests.push(["permission", request]);
        return {
          decision: "allow",
          updatedInput: {
            file_path: "/allowed/a",
            content: "rewritten",
          },
        };
      },
      questionHandler: async (request) => {
        requests.push(["question", request]);
        return {
          decision: "answer",
          answers: {
            Theme: "Dark",
          },
        };
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-interactions");
  assert.deepEqual(
    requests.map(([kind]) => kind),
    ["permission", "question"],
  );
  assert.deepEqual(sdkDecisions, [
    {
      behavior: "allow",
      updatedInput: {
        file_path: "/allowed/a",
        content: "rewritten",
      },
    },
    {
      behavior: "allow",
      updatedInput: {
        questions: [{
          question: "Theme",
          options: [
            { label: "Light" },
            { label: "Dark" },
          ],
        }],
        answers: {
          Theme: "Dark",
        },
      },
    },
  ]);
});


test("interactive foreground control pump can queue a mid-turn user message on the same SDK query", async () => {
  const seenUserMessages = [];
  const receipts = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: ({ prompt }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        const iterator = prompt[Symbol.asyncIterator]();
        const first = await iterator.next();
        seenUserMessages.push({
          text: first.value.message.content[0].text,
          uuid: first.value.uuid,
        });
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-controlled",
        };
        const second = await iterator.next();
        seenUserMessages.push({
          text: second.value.message.content[0].text,
          uuid: second.value.uuid,
        });
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-controlled",
          result: "UPDATED",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "initial",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      userMessageUuid:
        "44444444-4444-4444-8444-444444444444",
      controlPump: async (controller) => {
        await new Promise((resolve) => setImmediate(resolve));
        receipts.push(
          controller.sendUserMessage(
            "mid-turn update",
            {
              uuid:
                "55555555-5555-4555-8555-555555555555",
            },
          ),
        );
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-controlled");
  assert.deepEqual(seenUserMessages, [
    {
      text: "initial",
      uuid:
        "44444444-4444-4444-8444-444444444444",
    },
    {
      text: "mid-turn update",
      uuid:
        "55555555-5555-4555-8555-555555555555",
    },
  ]);
  assert.deepEqual(receipts, [{
    status: "queued",
    command_uuid:
      "55555555-5555-4555-8555-555555555555",
  }]);
});

test("interactive foreground control pump projects graceful interrupt as INTERRUPTED", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {
        release();
      },
      async interrupt() {
        release();
        return { still_queued: [] };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-interrupt-control",
        };
        await gate;
        throw new Error("provider interrupted execution");
      },
    }),
  });

  await assert.rejects(
    () =>
      transport.executeTurn(
        "long task",
        {
          mode: "new",
          parentProviderSessionId: null,
          streaming: true,
          controlPump: async (controller) => {
            await new Promise((resolve) => setImmediate(resolve));
            await controller.interrupt();
          },
        },
      ),
    (error) => error.runtimeCode === "INTERRUPTED",
  );
});


test("interactive foreground execution applies model thinking and effort selection", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successFixture("provider-selected-interactive")) {
            yield message;
          }
        },
      };
    },
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      execution: {
        model: "claude-sonnet-5",
        thinking: "adaptive",
        effort: "xhigh",
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-selected-interactive");
  assert.equal(call.options.model, "claude-sonnet-5");
  assert.deepEqual(call.options.thinking, { type: "adaptive" });
  assert.equal(call.options.effort, "xhigh");
  assert.equal(call.options.verbatimPrompts, true);
});


test("interactive foreground returns turn-boundary context usage without auto-compaction policy", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async getContextUsage() {
        return {
          model: "claude-opus-5-5",
          totalTokens: 760000,
          maxTokens: 1000000,
          rawMaxTokens: 1000000,
          percentage: 76,
          categories: [{
            name: "Messages",
            tokens: 700000,
            kind: "used",
            isDeferred: false,
          }],
        };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-context-interactive",
        };
        yield {
          type: "assistant",
          session_id: "provider-context-interactive",
          message: {
            content: [{ type: "text", text: "done" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-context-interactive",
          result: "done",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
    },
  );

  assert.deepEqual(result.contextUsage, {
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
  });
  assert.equal(result.contextUsageError, null);
});


test("interactive foreground returns execution readback for the exact requested selection", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async getSettings() {
        return {
          applied: {
            model: "claude-opus-5-5",
            effort: "high",
          },
        };
      },
      async supportedModels() {
        return [{
          value: "claude-opus-5-5",
          displayName: "Claude Opus 5.5",
          description: "test model",
          supportsEffort: true,
          supportedEffortLevels: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
          ],
          supportsAdaptiveThinking: true,
          supportsFastMode: false,
          supportsAutoMode: false,
        }];
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-execution-readback",
        };
        yield {
          type: "assistant",
          session_id: "provider-execution-readback",
          message: {
            content: [{ type: "text", text: "done" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-execution-readback",
          result: "done",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      execution: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      },
    },
  );

  assert.equal(result.executionReadbackError, null);
  assert.deepEqual(result.executionReadback, {
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
    }],
  });
});


test("deleteSession delegates to Agent SDK with the daemon cwd", async () => {
  const calls = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    queryImpl: () => fakeQuery([]),
    deleteSessionImpl: async (sessionId, options) => {
      calls.push({ sessionId, options });
    },
  });

  await transport.deleteSession("provider-old");

  assert.deepEqual(calls, [{
    sessionId: "provider-old",
    options: { dir: "/workspace/leilei-os" },
  }]);
});


test("listSessions reads the current working directory without mutating any session", async () => {
  let options;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    listSessionsImpl: async (input) => {
      options = input;
      return [
        {
          sessionId: "external-session-1",
          summary: "Current Claude Code work",
          customTitle: "Runtime work",
          firstPrompt: "continue",
          gitBranch: "main",
          cwd: "/workspace/leilei-os",
          lastModified: 123,
          createdAt: 100,
        },
      ];
    },
  });

  const sessions = await transport.listSessions();

  assert.deepEqual(options, {
    dir: "/workspace/leilei-os",
    limit: 100,
    offset: 0,
    includeWorktrees: false,
  });
  assert.deepEqual(sessions, [
    {
      sessionId: "external-session-1",
      summary: "Current Claude Code work",
      customTitle: "Runtime work",
      firstPrompt: "continue",
      gitBranch: "main",
      cwd: "/workspace/leilei-os",
      lastModified: 123,
      createdAt: 100,
    },
  ]);
});


test("LeileiOS MCP is injected into every foreground Agent SDK turn", async () => {
  let call;
  const mcpServerConfig = {
    type: "http",
    url: "https://leilei-os.example/internal/native-live-mcp",
    headers: {
      Authorization: "Bearer relay-secret",
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig,
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(successFixture("provider-mcp"));
    },
  });

  const result = await transport.executeTurn(
    "read today's todo",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
    },
  );

  assert.equal(result.providerSessionId, "provider-mcp");
  assert.deepEqual(call.options.mcpServers, {
    leileios: mcpServerConfig,
  });
  assert.equal(call.options.allowedTools, undefined);
});

test("LeileiOS MCP is also injected into non-interactive resume turns", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig: {
      type: "http",
      url: "https://leilei-os.example/internal/native-live-mcp",
      headers: {
        Authorization: "Bearer relay-secret",
      },
    },
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(successFixture("provider-existing"));
    },
  });

  await transport.resume("provider-existing", "continue");

  assert.equal(call.options.resume, "provider-existing");
  assert.equal(
    call.options.mcpServers.leileios.url,
    "https://leilei-os.example/internal/native-live-mcp",
  );
  assert.equal(call.options.allowedTools, undefined);
});


test("interactive foreground turn injects the local send_file MCP only when a handler is present", async () => {
  let call;
  let capturedHandler = null;
  const localServer = {
    type: "sdk",
    name: "local-send-file-test",
  };
  const remoteServer = {
    type: "http",
    url: "https://leilei-os.example/internal/native-live-mcp",
    headers: {
      Authorization: "Bearer relay-secret",
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig: remoteServer,
    createSendFileMcpServerImpl: async (handler) => {
      capturedHandler = handler;
      return localServer;
    },
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(
        successFixture("provider-send-file"),
      );
    },
  });

  const sendFileHandler = async (input) => ({
    attachmentId: "66666666-6666-4666-8666-666666666666",
    filename: input.displayName ?? "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 123,
    sha256: "a".repeat(64),
    kind: "file",
  });

  const result = await transport.executeTurn(
    "make and send the report",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      sendFileHandler,
    },
  );

  assert.equal(result.providerSessionId, "provider-send-file");
  assert.equal(capturedHandler, sendFileHandler);
  assert.deepEqual(call.options.mcpServers, {
    leileios: remoteServer,
    leileios_local: localServer,
  });
});

test("interactive foreground turn injects the local album MCP only when handlers are present", async () => {
  let call;
  let capturedHandlers = null;
  const localAlbumServer = {
    type: "sdk",
    name: "local-album-test",
  };
  const remoteServer = {
    type: "http",
    url: "https://leilei-os.example/internal/native-live-mcp",
    headers: {
      Authorization: "Bearer relay-secret",
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig: remoteServer,
    createAlbumMcpServerImpl: async (handlers) => {
      capturedHandlers = handlers;
      return localAlbumServer;
    },
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(
        successFixture("provider-album-tools"),
      );
    },
  });

  const albumHandlers = {
    async savePhoto() {
      throw new Error("unused");
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

  const result = await transport.executeTurn(
    "remember this photo",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      albumHandlers,
    },
  );

  assert.equal(
    result.providerSessionId,
    "provider-album-tools",
  );
  assert.equal(capturedHandlers, albumHandlers);
  assert.deepEqual(call.options.mcpServers, {
    leileios: remoteServer,
    leileios_album: localAlbumServer,
  });
});

test("interactive foreground turn trusts exact materialized attachment Read paths", async () => {
  const attachmentPath =
    "/tmp/leileios-native-live-inbox/c/p/a/photo.webp";
  let permissionCalls = 0;
  let sdkDecision = null;

  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        sdkDecision =
          await input.options.canUseTool(
            "Read",
            { file_path: attachmentPath },
            {
              toolUseID:
                "toolu_transport_attachment_read",
            },
          );
        for (const message of successFixture("provider-attachment-read")) {
          yield message;
        }
      },
    }),
  });

  const result = await transport.executeTurn(
    "look at the attachment",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      trustedReadPaths: [attachmentPath],
      permissionHandler: async () => {
        permissionCalls += 1;
        throw new Error("attachment Read must not prompt");
      },
    },
  );

  assert.equal(
    result.providerSessionId,
    "provider-attachment-read",
  );
  assert.deepEqual(
    sdkDecision,
    { behavior: "allow" },
  );
  assert.equal(permissionCalls, 0);
});

test("interactive foreground turn does not inject local send_file MCP without a handler", async () => {
  let call;
  let localFactoryCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    createSendFileMcpServerImpl: async () => {
      localFactoryCalls += 1;
      return { type: "sdk" };
    },
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-no-send-file"));
    },
  });

  await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
    },
  );

  assert.equal(localFactoryCalls, 0);
  assert.equal(call.options.mcpServers, undefined);
});

test("meme handler adds only its local SDK server and a sparse reaction hint",async()=>{
  let call,captured;
  const server={type:"sdk",name:"meme-test"};
  const handlers={async sendMeme(){throw new Error("unused");}};
  const transport=new AgentSdkClaudeTransport({environment:{},createMemeMcpServerImpl:async input=>{captured=input;return server;},queryImpl:input=>{call=input;return fakeQuery(successFixture("provider-meme"));}});
  await transport.executeTurn("hello",{mode:"new",parentProviderSessionId:null,streaming:true,memeHandlers:handlers});
  assert.equal(captured,handlers);
  assert.deepEqual(call.options.mcpServers,{leileios_memes:server});
  assert.match(call.options.systemPrompt.append,/nenecaramel\/leileios-album/);
  assert.match(call.options.systemPrompt.append,/existing GitHub\/Bash access/);
  assert.match(call.options.systemPrompt.append,/do not force one into every reply/);
  assert.equal(call.options.systemPrompt.append.includes("search_memes"),false);
});

test("without meme handler no meme server or hint is added",async()=>{
  let call;
  const transport=new AgentSdkClaudeTransport({environment:{},createMemeMcpServerImpl:async()=>{throw new Error("must not create");},queryImpl:input=>{call=input;return fakeQuery(successFixture("ordinary"));}});
  await transport.executeTurn("hello",{mode:"new",parentProviderSessionId:null,streaming:true});
  assert.equal(call.options.mcpServers,undefined);assert.equal(call.options.systemPrompt.append.includes("send_meme"),false);
  assert.match(call.options.systemPrompt.append,/To pass this wake without sending anything to the user, output exactly <quiet \/> and nothing else\./);
});

 test("all-directory listing preserves SDK cwd and never invents a default for unknown directories", async () => {
  let options;
  const transport = new AgentSdkClaudeTransport({ environment: {}, cwd: "/default", listSessionsImpl: async input => {
    options = input;
    return [{sessionId: "historical", cwd: "/historical"}, {sessionId: "unknown"}];
  }});
  const rows = await transport.listSessions({allDirectories: true});
  assert.equal(Object.hasOwn(options, "dir"), false);
  assert.deepEqual(rows.map(row => [row.sessionId, row.cwd]), [["historical", "/historical"]]);
});

test("Native Live SDK explicitly bypasses the standalone Claude Code Mind hook", () => {
  const environment = {LEILEI_MIND_HOOK_DISABLED: "0", HOME: "/tmp/leileios-test"};
  const transport = new AgentSdkClaudeTransport({environment});
  assert.equal(transport.environment.LEILEI_MIND_HOOK_DISABLED, "1");
  assert.equal(environment.LEILEI_MIND_HOOK_DISABLED, "0");
});
